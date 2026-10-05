<?php

namespace Tests\Feature;

use App\Models\AccountDeletionRequest;
use App\Models\PrivacyRightsRequest;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Public HTTP, real SQL interleavings and response cookies on guarded *_test. */
final class AccountDeletionBoundaryTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox, mail_outbox, notifications RESTART IDENTITY CASCADE');
        Queue::fake();
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'deletion-boundary-csrf')->withHeader('X-CSRF-Token', 'deletion-boundary-csrf');
        $this->freezeSecond();
    }

    private function actorSession(User $user): string
    {
        $raw = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true);
        $this->withCookie((string) config('session.cookie'), $raw);

        return Ids::sha256Hex($raw);
    }

    private function pending(User $user, ?int $offset = 3600): array
    {
        $token = Ids::randomToken(32);
        $row = AccountDeletionRequest::create([
            'user_id' => $user->id, 'security_version' => (int) $user->security_version,
            'status' => 'requested', 'confirmation_token_hash' => Ids::sha256Hex($token),
            'confirmation_expires_at' => $offset === null ? null : now()->addSeconds($offset),
        ]);

        return [$row, $token];
    }

    private function privateImpact(User $user): array
    {
        $workspace = Workspace::forceCreate(['owner_user_id' => $user->id, 'name' => 'Workspace privado del expediente', 'slug' => 'private-deletion-fixture']);
        $privacy = PrivacyRightsRequest::create([
            'user_id' => $user->id, 'security_version' => (int) $user->security_version,
            'type' => 'access', 'status' => 'submitted', 'generation_hash' => Ids::sha256Hex('deletion-private-case'),
            'identity_verified_at' => now(), 'due_at' => now()->addMonth(),
        ]);
        [$pending] = $this->pending($user);

        return [$workspace, $privacy, $pending];
    }

    public static function invalidContexts(): array
    {
        return array_map(static fn ($state) => [$state], ['revoked', 'expired', 'session-version', 'foreign-owner', 'blocked', 'unverified', 'account-version']);
    }

    #[DataProvider('invalidContexts')]
    public function test_impact_revalidates_the_actor_after_middleware_hydration(string $state): void
    {
        $user = User::factory()->create();
        $other = User::factory()->create();
        $sessionId = $this->actorSession($user);
        [$workspace, $privacy, $pending] = $this->privateImpact($user);
        $before = $pending->fresh()->getAttributes();
        $injected = false;
        DB::listen(static function (QueryExecuted $query) use ($state, $user, $other, $sessionId, &$injected): void {
            if ($injected || ! str_starts_with($query->sql, 'select * from "users"') || str_contains($query->sql, 'for update')) {
                return;
            }
            $injected = true;
            match ($state) {
                'revoked' => DB::table('sessions')->where('id', $sessionId)->update(['revoked_at' => now()]),
                'expired' => DB::table('sessions')->where('id', $sessionId)->update(['expires_at' => now()]),
                'session-version' => DB::table('sessions')->where('id', $sessionId)->update(['security_version' => 2]),
                'foreign-owner' => DB::table('sessions')->where('id', $sessionId)->update(['user_id' => $other->id]),
                'blocked' => DB::table('users')->where('id', $user->id)->update(['deleted_at' => now()]),
                'unverified' => DB::table('users')->where('id', $user->id)->update(['email_verified_at' => null]),
                'account-version' => DB::table('users')->where('id', $user->id)->update(['security_version' => 2]),
            };
        });
        $response = $this->getJson('/api/v1/auth/account-deletion');
        $this->assertTrue($injected);
        // Keep the original disclosure observable before the status assertion.
        if ($response->status() === 200) {
            $response->assertJsonPath('ownedWorkspaces.0.name', $workspace->name)->assertJsonPath('blockingPrivacyRequests.0.id', $privacy->id);
        }
        $response->assertStatus(401)->assertJsonMissingPath('ownedWorkspaces')->assertJsonMissingPath('blockingPrivacyRequests')->assertJsonMissingPath('request')->assertCookieMissing('uvh_session');
        $this->assertSame($before, $pending->fresh()->getAttributes());
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('audit_events', 0);
        Queue::assertNothingPushed();
    }

    public function test_valid_impact_returns_only_the_owner_snapshot_without_business_transaction_or_writes(): void
    {
        $user = User::factory()->create();
        $this->actorSession($user);
        [$workspace, $privacy, $pending] = $this->privateImpact($user);
        $queries = [];
        DB::listen(static function (QueryExecuted $query) use (&$queries): void {
            if (str_contains($query->sql, '"workspaces"') || str_contains($query->sql, '"privacy_rights_requests"')) {
                $queries[] = [$query->sql, $query->connection->transactionLevel()];
            }
        });
        $this->getJson('/api/v1/auth/account-deletion')->assertOk()->assertJsonPath('canDelete', false)->assertJsonPath('isPlatformAdmin', false)
            ->assertJsonPath('ownedWorkspaces.0.id', $workspace->id)->assertJsonPath('blockingPrivacyRequests.0.id', $privacy->id)
            ->assertJsonPath('request.confirmationExpiresAt', $pending->confirmation_expires_at->toIso8601String());
        $this->assertNotEmpty($queries);
        foreach ($queries as [$sql, $level]) {
            $this->assertStringStartsWith('select', $sql);
            $this->assertStringNotContainsString('for update', $sql);
            $this->assertSame(0, $level);
        }
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
    }

    public static function roles(): array
    {
        return [[false, true], [true, false]];
    }

    #[DataProvider('roles')]
    public function test_impact_uses_the_current_role_after_hydration(bool $old, bool $current): void
    {
        $user = User::factory()->create(['is_admin' => $old]);
        $this->actorSession($user);
        $injected = false;
        DB::listen(static function (QueryExecuted $query) use ($user, $current, &$injected): void {
            if (! $injected && str_starts_with($query->sql, 'select * from "users"')) {
                $injected = true;
                DB::table('users')->where('id', $user->id)->update(['is_admin' => $current]);
            }
        });
        $this->getJson('/api/v1/auth/account-deletion')->assertOk()->assertJsonPath('isPlatformAdmin', $current)->assertJsonPath('canDelete', ! $current);
        $this->assertTrue($injected);
    }

    public static function owners(): array
    {
        return [['own'], ['foreign'], ['anonymous']];
    }

    #[DataProvider('owners')]
    public function test_confirmation_only_clears_the_cookie_of_its_own_account(string $owner): void
    {
        $target = User::factory()->create();
        $other = User::factory()->create();
        $targetSession = $this->actorSession($target);
        [$row, $token] = $this->pending($target);
        $otherSession = $owner === 'foreign' ? $this->actorSession($other) : null;
        if ($owner === 'anonymous') {
            $this->withCookie((string) config('session.cookie'), '');
        }
        $response = $this->postJson('/api/v1/auth/account-deletion/confirm', ['token' => $token])->assertOk();
        $this->assertSame('scheduled', $row->refresh()->status);
        $this->assertNotNull($target->refresh()->deleted_at);
        $this->assertNotNull(DB::table('sessions')->where('id', $targetSession)->value('revoked_at'));
        $this->assertNull($other->refresh()->deleted_at);
        if ($owner === 'own') {
            $response->assertCookieExpired('uvh_session');
        } else {
            if ($otherSession !== null) {
                $this->assertNull(DB::table('sessions')->where('id', $otherSession)->value('revoked_at'));
                $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('user.id', $other->id);
            }
            $response->assertCookieMissing('uvh_session');
        }
        $response->assertJsonPath('current', $owner === 'own');
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.deletion_scheduled')->count());
        $this->assertDatabaseCount('mail_outbox', 1);
    }

    public static function deadlines(): array
    {
        return [['null', null], ['past', -1], ['exact', 0], ['future', 1]];
    }

    #[DataProvider('deadlines')]
    public function test_confirmation_deadline_matches_the_impact_projection(string $name, ?int $offset): void
    {
        $user = User::factory()->create();
        $sessionId = $this->actorSession($user);
        [$row, $token] = $this->pending($user, $offset);
        $this->getJson('/api/v1/auth/account-deletion')->assertOk()->assertJsonPath('request.status', $name === 'future' ? 'requested' : null);
        $response = $this->postJson('/api/v1/auth/account-deletion/confirm', ['token' => $token]);
        if ($name === 'future') {
            $response->assertOk();
            $this->assertSame('scheduled', $row->refresh()->status);
        } else {
            $response->assertStatus(400)->assertCookieMissing('uvh_session');
            $this->assertSame('expired', $row->refresh()->status);
            $this->assertNull($row->confirmation_token_hash);
            $this->assertNull($user->refresh()->deleted_at);
            $this->assertNull(DB::table('sessions')->where('id', $sessionId)->value('revoked_at'));
            $this->assertDatabaseCount('mail_outbox', 0);
            $this->assertDatabaseCount('audit_events', 0);
        }
    }
}
