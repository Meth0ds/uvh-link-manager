<?php

namespace Tests\Feature;

use App\Jobs\DeliverMailOutboxJob;
use App\Models\Invitation;
use App\Models\User;
use App\Support\Ids;
use App\Support\MailDeliveryEligibility;
use App\Support\MailLifecycleCompensator;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Prepared only; the parent rejects non-*_test databases before TRUNCATE. */
final class InvitationExpiryTest extends TestCase
{
    private bool $failAdmission = false;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, mail_outbox, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        config(['cache.default' => 'array']);
        $this->travelTo(now()->startOfSecond());
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'invitation-expiry-csrf')->withHeader('X-CSRF-Token', 'invitation-expiry-csrf');
        Queue::fake();
        DB::listen(function (QueryExecuted $event): void {
            if ($this->failAdmission && str_starts_with(strtolower($event->sql), 'insert')
                && str_contains($event->sql, '"mail_outbox"')) {
                // Throw AFTER insertion to prove no partial envelope survives.
                throw new \RuntimeException('Fixture: invitation admission interrupted');
            }
        });
    }

    public static function renewals(): array
    {
        return [
            'reinvite expired pending' => ['invite', 'pending', false],
            'reinvite rollback' => ['invite', 'pending', true],
            'resend expired pending' => ['resend', 'pending', false],
            'resend pending rollback' => ['resend', 'pending', true],
            'resend stored expiry' => ['resend', 'expired', false],
            'resend expiry rollback' => ['resend', 'expired', true],
        ];
    }

    #[DataProvider('renewals')]
    public function test_renewal_rotates_the_bearer_atomically(string $operation, string $status, bool $fail): void
    {
        [, $target, $workspace, $invitation, $oldToken] = $this->fixture($status);
        $expires = $invitation->expires_at->toIso8601String();
        $this->failAdmission = $fail;
        $url = '/api/v1/workspaces/'.$workspace->id.'/invitations';
        $payload = ['email' => $target->email, 'role' => 'viewer'];
        if ($operation === 'resend') {
            $url .= '/'.$invitation->id.'/resend';
            $payload = [];
        }
        $this->postJson($url, $payload)->assertStatus($fail ? 503 : ($operation === 'invite' ? 201 : 200));
        if ($fail) {
            $this->assertSame($status, $invitation->refresh()->status);
            $this->assertSame(Ids::sha256Hex($oldToken), $invitation->token);
            $this->assertSame($expires, $invitation->expires_at->toIso8601String());
            $this->assertDatabaseCount('mail_outbox', 0);
            Queue::assertNothingPushed();
            $this->failAdmission = false;
            $this->postJson($url, $payload)->assertStatus($operation === 'invite' ? 201 : 200);
        }
        $this->assertDatabaseCount('invitations', 1);
        $this->assertSame('pending', $invitation->refresh()->status);
        $this->assertNotSame(Ids::sha256Hex($oldToken), $invitation->token);
        $this->assertTrue($invitation->expires_at->equalTo(now()->addDays(7)));
        $this->assertDatabaseCount('mail_outbox', 1);
        $row = DB::table('mail_outbox')->first();
        $this->assertTrue(MailDeliveryEligibility::isCurrent($row));
        $envelope = json_decode(UvhCrypto::decryptAtRest($row->encrypted_envelope), true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame($target->email, $envelope['to']);
        $this->assertSame(1, preg_match('/#token=([A-Za-z0-9_-]{43})/', $envelope['text'], $matches));
        $newToken = $matches[1];
        $this->assertSame(Ids::sha256Hex($newToken), $invitation->token);
        // A late failure of the old generation must not cancel the renewal.
        MailLifecycleCompensator::compensate('invitation', 'invitation', $invitation->id, Ids::sha256Hex($oldToken));
        $this->assertSame('pending', $invitation->refresh()->status);
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
        $this->signIn($target);
        $this->postJson('/api/v1/workspaces/invitations/accept', ['token' => $oldToken])->assertStatus(400);
        $this->postJson('/api/v1/workspaces/invitations/accept', ['token' => $newToken])->assertOk();
        $this->assertDatabaseHas('memberships', ['workspace_id' => $workspace->id, 'user_id' => $target->id, 'role' => 'viewer']);
    }

    public static function decisions(): array
    {
        return ['accept' => ['accept'], 'reject' => ['reject']];
    }

    #[DataProvider('decisions')]
    public function test_expiry_is_exclusive_at_the_exact_boundary(string $decision): void
    {
        [, $target, $workspace, $invitation, $token] = $this->fixture();
        $invitation->update(['expires_at' => now()]);
        $this->signIn($target);
        $this->postJson('/api/v1/workspaces/invitations/'.$decision, ['token' => $token])->assertStatus(400);
        $this->assertDatabaseMissing('memberships', ['workspace_id' => $workspace->id, 'user_id' => $target->id]);
        $this->assertSame('pending', $invitation->refresh()->status);
    }

    public function test_listing_projects_expiry_without_writing_and_live_pending_still_conflicts(): void
    {
        [, $target, $workspace, $invitation] = $this->fixture();
        $this->getJson('/api/v1/workspaces/'.$workspace->id)->assertOk()->assertJsonPath('invitations.0.status', 'expired');
        $this->assertSame('pending', $invitation->refresh()->status);
        $invitation->update(['expires_at' => now()->addMinute()]);
        $this->getJson('/api/v1/workspaces/'.$workspace->id)->assertOk()->assertJsonPath('invitations.0.status', 'pending');
        $this->postJson('/api/v1/workspaces/'.$workspace->id.'/invitations', ['email' => $target->email, 'role' => 'viewer'])->assertConflict();
        $this->assertDatabaseCount('mail_outbox', 0);
    }

    public static function conflicts(): array
    {
        return ['another pending row' => [false], 'existing member' => [true]];
    }

    #[DataProvider('conflicts')]
    public function test_resend_does_not_revive_a_conflicting_expired_row(bool $member): void
    {
        [$owner, $target, $workspace, $invitation, $token] = $this->fixture('expired');
        if ($member) {
            $workspace->memberships()->create(['user_id' => $target->id, 'role' => 'viewer']);
        } else {
            Invitation::create([
                'workspace_id' => $workspace->id, 'invited_by' => $owner->id, 'email' => $target->email,
                'role' => 'viewer', 'status' => 'pending', 'token' => Ids::sha256Hex('other-fixture'), 'expires_at' => now()->addDay(),
            ]);
        }
        $this->postJson('/api/v1/workspaces/'.$workspace->id.'/invitations/'.$invitation->id.'/resend')->assertConflict();
        $this->assertSame('expired', $invitation->refresh()->status);
        $this->assertSame(Ids::sha256Hex($token), $invitation->token);
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();
    }

    private function fixture(string $status = 'pending'): array
    {
        $owner = User::factory()->create();
        $target = User::factory()->create();
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Expiry fixture', 'slug' => 'expiry-fixture']);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $token = Ids::randomToken(32);
        $invitation = Invitation::create([
            'workspace_id' => $workspace->id, 'invited_by' => $owner->id, 'email' => $target->email,
            'role' => 'viewer', 'status' => $status, 'token' => Ids::sha256Hex($token), 'expires_at' => now()->subSecond(),
        ]);
        $this->signIn($owner);

        return [$owner, $target, $workspace, $invitation, $token];
    }

    private function signIn(User $user): void
    {
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), 1));
    }
}
