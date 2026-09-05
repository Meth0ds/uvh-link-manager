<?php

namespace Tests\Feature;

use App\Models\AccountDeletionRequest;
use App\Models\Invitation;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\MailAdmissionException;
use App\Support\MailDeliveryEligibility;
use App\Support\MailLifecycleCompensator;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Prepared only: TestCase checks *_test before these destructive fixtures. */
final class InvitationAuthorityLifecycleTest extends TestCase
{
    private const PASSWORD = 'tiovivo-cobrizo-astilla-42';
    private int $failMailInsert = 0;
    private int $mailInserts = 0;
    private bool $failIssuedRevocation = false;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, mail_outbox, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        config(['cache.default' => 'array']);
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'invitation-authority-csrf')->withHeader('X-CSRF-Token', 'invitation-authority-csrf');
        Queue::fake();
        DB::listen(function (QueryExecuted $event): void {
            $sql = strtolower($event->sql);
            if (str_starts_with($sql, 'insert') && str_contains($sql, '"mail_outbox"')) {
                $this->mailInserts++;
                if ($this->failMailInsert === $this->mailInserts) {
                    throw new \RuntimeException('Fixture: second ownership notice admission failed');
                }
            }
            // Fail AFTER the revocation SQL, not before the first mutation:
            // scheduling, suspension, grants and the admitted notice must roll back.
            if ($this->failIssuedRevocation && str_starts_with($sql, 'update "invitations"')
                && str_contains($sql, '"invited_by"')) {
                throw new MailAdmissionException('Fixture: interrupted after issuer revocation');
            }
        });
    }

    public static function transferFailures(): array
    {
        return ['success' => [false], 'second notice rollback then retry' => [true]];
    }

    #[DataProvider('transferFailures')]
    public function test_ownership_return_does_not_revive_old_admin_invites(bool $fail): void
    {
        $owner = $this->user();
        $successor = $this->user();
        $workspace = $this->workspace($owner);
        $workspace->memberships()->create(['user_id' => $successor->id, 'role' => 'viewer']);
        [$admin, $adminToken, $adminTarget] = $this->invite($workspace, $owner, 'admin');
        [$editor] = $this->invite($workspace, $owner, 'editor');
        [$viewer, $viewerToken, $viewerTarget] = $this->invite($workspace, $owner, 'viewer');
        [$otherWorkspaceInvite] = $this->invite($this->workspace($owner), $owner, 'admin');
        $this->signIn($owner);
        $url = '/api/v1/workspaces/'.$workspace->id.'/transfer-ownership';
        $payload = ['targetUserId' => (int) $successor->id, 'password' => self::PASSWORD];
        $this->failMailInsert = $fail ? 2 : 0;
        $this->postJson($url, $payload)->assertStatus($fail ? 503 : 200);
        if ($fail) {
            $this->assertGrant($admin, 'pending', true);
            $this->assertDatabaseHas('workspaces', ['id' => $workspace->id, 'owner_user_id' => $owner->id]);
            $this->assertDatabaseCount('mail_outbox', 0);
            Queue::assertNothingPushed();
            $this->failMailInsert = 0;
            $this->postJson($url, $payload)->assertOk();
        }
        $this->assertGrant($admin, 'cancelled', false);
        $this->assertGrant($editor, 'pending', true);
        $this->assertGrant($viewer, 'pending', true);
        $this->assertGrant($otherWorkspaceInvite, 'pending', true);

        // Restore ownership using its real endpoint, without consuming the old
        // invitation during the interval: acceptance must not be what revokes it.
        $this->signIn($successor);
        $this->postJson($url, ['targetUserId' => (int) $owner->id, 'password' => self::PASSWORD])->assertOk();
        $this->assertGrant($admin, 'cancelled', false);
        $this->signIn($adminTarget);
        $this->postJson('/api/v1/workspaces/invitations/accept', ['token' => $adminToken])->assertStatus(400);
        $this->assertDatabaseMissing('memberships', ['workspace_id' => $workspace->id, 'user_id' => $adminTarget->id]);
        $this->signIn($viewerTarget);
        $this->postJson('/api/v1/workspaces/invitations/accept', ['token' => $viewerToken])->assertOk();
    }

    public static function restorations(): array
    {
        return ['explicit cancellation' => [false, false], 'late rollback then cancellation' => [true, false], 'mail compensation' => [false, true]];
    }

    #[DataProvider('restorations')]
    public function test_restoring_a_scheduled_account_does_not_restore_issued_grants(bool $fail, bool $compensate): void
    {
        $owner = $this->user();
        $issuer = $this->user();
        $workspace = $this->workspace($owner);
        $workspace->memberships()->create(['user_id' => $issuer->id, 'role' => 'admin']);
        [$issued, $issuedToken, $target] = $this->invite($workspace, $issuer, 'viewer');
        [$unrelated] = $this->invite($workspace, $owner, 'viewer');
        [$received] = $this->invite($this->workspace($owner), $owner, 'viewer', $issuer);
        $confirmToken = Ids::randomToken(32);
        $deletion = AccountDeletionRequest::create([
            'user_id' => $issuer->id, 'security_version' => 1, 'status' => 'requested',
            'confirmation_token_hash' => Ids::sha256Hex($confirmToken), 'confirmation_expires_at' => now()->addHour(),
        ]);
        $this->signIn($issuer);
        $this->failIssuedRevocation = $fail;
        $this->postJson('/api/v1/auth/account-deletion/confirm', ['token' => $confirmToken])->assertStatus($fail ? 503 : 200);
        if ($fail) {
            $this->assertNull($issuer->refresh()->deleted_at);
            $this->assertSame(1, $issuer->security_version);
            $this->assertSame('requested', $deletion->refresh()->status);
            $this->assertGrant($issued, 'pending', true);
            $this->assertGrant($received, 'pending', true);
            $this->assertSame(1, DB::table('sessions')->where('user_id', $issuer->id)->whereNull('revoked_at')->count());
            $this->assertDatabaseCount('mail_outbox', 0);
            Queue::assertNothingPushed();
            $this->failIssuedRevocation = false;
            $this->postJson('/api/v1/auth/account-deletion/confirm', ['token' => $confirmToken])->assertOk();
        }
        $this->assertNotNull($issuer->refresh()->deleted_at);
        $this->assertGrant($issued, 'cancelled', false);
        $this->assertGrant($received, 'cancelled', false);
        $this->assertGrant($unrelated, 'pending', true);
        $deletion->refresh();
        if ($compensate) {
            // Exercise the same restoration used when scheduled mail exhausts;
            // this is a direct fixture call, not a running delivery-worker test.
            MailLifecycleCompensator::compensate('account_deletion_scheduled', 'account_deletion', $deletion->id, $deletion->cancel_token_hash);
        } else {
            $row = DB::table('mail_outbox')->where('kind', 'account_deletion_scheduled')->first();
            $envelope = json_decode(UvhCrypto::decryptAtRest($row->encrypted_envelope), true, 512, JSON_THROW_ON_ERROR);
            $this->assertSame(1, preg_match('/#token=([A-Za-z0-9_-]{43})/', $envelope['text'], $matches));
            $this->postJson('/api/v1/auth/account-deletion/cancel', ['token' => $matches[1]])->assertOk();
        }
        $this->assertNull($issuer->refresh()->deleted_at);
        $this->assertSame('cancelled', $deletion->refresh()->status);
        $this->assertGrant($issued, 'cancelled', false);
        $this->assertGrant($received, 'cancelled', false);
        $this->assertGrant($unrelated, 'pending', true);
        $this->signIn($target);
        $this->postJson('/api/v1/workspaces/invitations/accept', ['token' => $issuedToken])->assertStatus(400);
        $this->assertDatabaseMissing('memberships', ['workspace_id' => $workspace->id, 'user_id' => $target->id]);
    }

    public function test_demotion_then_promotion_keeps_issued_grants_revoked(): void
    {
        $owner = $this->user();
        $issuer = $this->user();
        $workspace = $this->workspace($owner);
        $workspace->memberships()->create(['user_id' => $issuer->id, 'role' => 'admin']);
        [$invitation] = $this->invite($workspace, $issuer, 'viewer');
        $this->signIn($owner);
        $url = '/api/v1/workspaces/'.$workspace->id.'/members/'.$issuer->id;
        $this->patchJson($url, ['role' => 'editor'])->assertOk();
        $this->patchJson($url, ['role' => 'admin'])->assertOk();
        $this->assertGrant($invitation, 'cancelled', false);
    }

    private function assertGrant(Invitation $invitation, string $status, bool $eligible): void
    {
        $this->assertSame($status, $invitation->refresh()->status);
        // Exercise the delivery predicate using the original generation fields;
        // no provider or worker runs in this fixture.
        $this->assertSame($eligible, MailDeliveryEligibility::isCurrent((object) [
            'kind' => 'invitation', 'resource_type' => 'invitation',
            'resource_id' => (string) $invitation->id, 'resource_generation' => $invitation->token,
        ]));
    }

    private function user(): User
    {
        return User::factory()->create(['password_hash' => Hash::make(self::PASSWORD)]);
    }

    private function workspace(User $owner): Workspace
    {
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Authority fixture', 'slug' => 'authority-'.strtolower(Ids::randomToken(8))]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        return $workspace;
    }

    private function invite(Workspace $workspace, User $issuer, string $role, ?User $target = null): array
    {
        $target ??= $this->user();
        $token = Ids::randomToken(32);
        $invitation = Invitation::create([
            'workspace_id' => $workspace->id, 'invited_by' => $issuer->id, 'email' => $target->email,
            'role' => $role, 'status' => 'pending', 'token' => Ids::sha256Hex($token), 'expires_at' => now()->addDay(),
        ]);
        return [$invitation, $token, $target];
    }

    private function signIn(User $user): void
    {
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), (int) $user->refresh()->security_version));
    }
}
