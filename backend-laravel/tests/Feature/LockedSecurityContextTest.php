<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Ids;
use App\Support\SecurityContext;
use App\Support\SessionManager;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class LockedSecurityContextTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions RESTART IDENTITY CASCADE');
        $this->travelTo(now()->startOfSecond());
    }

    public static function invalidContexts(): array
    {
        return array_map(static fn (string $change): array => [$change], [
            'null-session', 'revoked', 'expired', 'session-version', 'foreign', 'missing-session',
            'account-version', 'account-deleted', 'missing-account', 'unverified',
        ]);
    }

    #[DataProvider('invalidContexts')]
    public function test_factory_rejects_stale_or_unrelated_authority(string $change): void
    {
        $user = User::factory()->create(['email_verified_at' => now()]);
        $other = User::factory()->create(['email_verified_at' => now()]);
        $id = Ids::sha256Hex(SessionManager::create($user->id, Request::create('/'), 1));
        $session = DB::table('sessions')->where('id', $id);
        $account = DB::table('users')->where('id', $user->id);
        match ($change) {
            'null-session' => $id = null,
            'revoked' => $session->update(['revoked_at' => now()]),
            'expired' => $session->update(['expires_at' => now()]),
            'session-version' => $session->update(['security_version' => 2]),
            'foreign' => $session->update(['user_id' => $other->id]),
            'missing-session' => $session->delete(),
            'account-version' => $account->update(['security_version' => 2]),
            'account-deleted' => $account->update(['deleted_at' => now()]),
            'missing-account' => $account->delete(),
            'unverified' => $account->update(['email_verified_at' => null]),
        };
        $this->assertNull(DB::transaction(static fn () => SecurityContext::lock($user, $id, true)));
        $this->assertNull(DB::transaction(static fn () => SecurityContext::lockWithUsers($user, $id, [$other->id], true)));
    }

    public function test_valid_context_reuses_one_locked_account_and_one_locked_session(): void
    {
        $user = User::factory()->create(['email_verified_at' => now()]);
        $id = Ids::sha256Hex(SessionManager::create($user->id, Request::create('/'), 1));
        $selects = [];
        DB::listen(static function (QueryExecuted $event) use (&$selects): void {
            if (str_contains($event->sql, 'for update')) {
                $selects[] = $event->sql;
            }
        });
        DB::transaction(function () use ($user, $id): void {
            $context = SecurityContext::lock($user, $id, true);
            $this->assertNotNull($context);
            $this->assertSame($user->id, $context->user->id);
            $this->assertSame($id, $context->session->id);
            $this->assertSame($context->user, $context->relatedUser($user->id));
        });
        $this->assertCount(2, $selects);
        $this->assertStringContainsString('from "users"', $selects[0]);
        $this->assertStringContainsString('from "sessions"', $selects[1]);
    }

    public function test_related_users_are_locked_in_primary_key_order_before_the_session(): void
    {
        $related = User::factory()->create(['email_verified_at' => now()]);
        $actor = User::factory()->create(['email_verified_at' => now()]);
        $id = Ids::sha256Hex(SessionManager::create($actor->id, Request::create('/'), 1));
        $locks = [];
        DB::listen(static function (QueryExecuted $event) use (&$locks): void {
            if (str_contains($event->sql, 'for update')) {
                $locks[] = $event->sql;
            }
        });
        DB::transaction(function () use ($actor, $related, $id): void {
            $context = SecurityContext::lockWithUsers($actor, $id, [$actor->id, $related->id, $related->id], true);
            $this->assertNotNull($context);
            $this->assertSame($related->id, $context->relatedUser($related->id)?->id);
            $this->assertNull($context->relatedUser(99999));
        });
        $this->assertCount(2, $locks);
        $this->assertStringContainsString('order by "id" asc for update', $locks[0]);
        $this->assertStringContainsString('from "sessions"', $locks[1]);
    }

    public function test_legacy_unverified_context_requires_an_explicit_verified_policy_to_reject(): void
    {
        $user = User::factory()->create(['email_verified_at' => null]);
        $id = Ids::sha256Hex(SessionManager::create($user->id, Request::create('/'), 1));
        DB::transaction(function () use ($user, $id): void {
            $this->assertNotNull(SecurityContext::lock($user, $id));
            $this->assertNull(SecurityContext::lock($user, $id, true));
        });
    }

    public function test_factory_cannot_claim_row_locks_outside_a_transaction(): void
    {
        $user = User::factory()->create();
        $this->expectException(\LogicException::class);
        SecurityContext::lock($user, null);
    }

    public static function competingRevocations(): array
    {
        return [['session'], ['account']];
    }

    #[DataProvider('competingRevocations')]
    public function test_locks_serialize_revocation_from_an_independent_database_connection(string $resource): void
    {
        $user = User::factory()->create(['email_verified_at' => now()]);
        $id = Ids::sha256Hex(SessionManager::create($user->id, Request::create('/'), 1));
        $connectionName = 'security_context_race';
        config(['database.connections.'.$connectionName => config('database.connections.pgsql')]);
        $competing = DB::connection($connectionName);
        try {
            $this->assertSame('uvh_test', $competing->getDatabaseName());
            $this->assertNotSame(DB::selectOne('SELECT pg_backend_pid() AS pid')->pid, $competing->selectOne('SELECT pg_backend_pid() AS pid')->pid);
            $competing->statement("SET lock_timeout = '50ms'");
            $revoke = static function () use ($competing, $resource, $user, $id): void {
                if ($resource === 'session') {
                    $competing->table('sessions')->where('id', $id)->update(['revoked_at' => now()]);
                } else {
                    $competing->table('users')->where('id', $user->id)->increment('security_version');
                }
            };
            DB::transaction(function () use ($user, $id, $revoke): void {
                $this->assertNotNull(SecurityContext::lock($user, $id, true));
                try {
                    $revoke();
                    $this->fail('A competing revocation must wait for the transaction holding the authority locks');
                } catch (QueryException $error) {
                    $this->assertSame('55P03', (string) $error->getCode());
                }
                $this->assertDatabaseHas('sessions', ['id' => $id, 'revoked_at' => null]);
                $this->assertDatabaseHas('users', ['id' => $user->id, 'security_version' => 1]);
            });
            $revoke();
            $this->assertNull(DB::transaction(static fn () => SecurityContext::lock($user, $id, true)));
        } finally {
            DB::purge($connectionName);
        }
    }
}
