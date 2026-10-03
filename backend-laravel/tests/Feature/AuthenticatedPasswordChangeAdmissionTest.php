<?php

namespace Tests\Feature;

use App\Jobs\DeliverMailOutboxJob;
use App\Models\AccountRecoveryRequest;
use App\Models\User;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class AuthenticatedPasswordChangeAdmissionTest extends TestCase
{
    private const CURRENT = 'tiovivo-cobrizo-astilla-42';

    private const NEXT = 'brujula-limonero-zafiro-93';

    private const RECOVERY = 'ABCD2345EFGH6789';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, mail_outbox, audit_events, audit_outbox, operational_metrics RESTART IDENTITY CASCADE');
        Queue::fake();
        $this->travelTo(now()->startOfSecond());
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'password-admission')->withHeader('X-CSRF-Token', 'password-admission');
    }

    private function owner(bool $mfa = true): User
    {
        return User::factory()->create([
            'name' => 'Change Person', 'email' => 'change-person@example.test',
            'password_hash' => Hash::make(self::CURRENT), 'mfa_enabled' => $mfa,
            'mfa_secret' => $mfa ? UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP') : null,
            'recovery_codes' => $mfa ? [Ids::sha256Hex(self::RECOVERY)] : null,
        ])->refresh();
    }

    private function useSession(User $owner): string
    {
        $token = SessionManager::create($owner->id, Request::create('/'), (int) $owner->security_version, (bool) $owner->mfa_enabled);
        $this->withCookie('uvh_session', $token);

        return Ids::sha256Hex($token);
    }

    private function payload(bool $mfa = true): array
    {
        return ['current' => self::CURRENT, 'newPassword' => self::NEXT, 'factorCode' => $mfa ? self::RECOVERY : ''];
    }

    public static function liveChanges(): array
    {
        return [
            ['blocked', 409], ['account_version', 409], ['revoked', 409],
            ['expired', 409], ['expiry_equal', 409], ['session_version', 409],
            ['foreign', 409], ['password', 403], ['name', 422], ['email', 422],
            ['freshness_old', 403], ['freshness_null', 409], ['recovery_removed', 403],
            ['mfa_enabled', 409],
        ];
    }

    #[DataProvider('liveChanges')]
    public function test_live_authority_is_rechecked_after_hydration(string $change, int $status): void
    {
        $mfa = $change !== 'mfa_enabled';
        $owner = $this->owner($mfa);
        $foreign = User::factory()->create();
        $sessionId = $this->useSession($owner);
        DB::table('sessions')->where('id', $sessionId)->update(['last_used_at' => now()->subMinutes(2)]);
        $changed = false;
        $credentialState = null;
        DB::listen(static function (QueryExecuted $query) use ($owner, $foreign, $sessionId, $change, &$changed, &$credentialState): void {
            // hydrate has already loaded its User and Session objects when it
            // persists last_used_at. Change SQL state before the caller locks.
            if ($changed || ! str_starts_with($query->sql, 'update "sessions"')
                || ! str_contains($query->sql, '"last_used_at"')) {
                return;
            }
            $changed = true;
            $userChanges = match ($change) {
                'blocked' => ['deleted_at' => now()],
                'account_version' => ['security_version' => 2],
                'password' => ['password_hash' => Hash::make('magnolia-zafiro-astrolabio-29')],
                'name' => ['name' => 'Brujula'],
                'email' => ['email' => 'brujula@example.test'],
                'mfa_enabled' => ['mfa_enabled' => true, 'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP')],
                default => [],
            };
            // User's encrypted recovery cast is owned by Eloquent.
            if ($change === 'recovery_removed') {
                $owner->forceFill(['recovery_codes' => []])->save();
            } elseif ($userChanges !== []) {
                DB::table('users')->where('id', $owner->id)->update($userChanges);
            }
            $sessionChanges = match ($change) {
                'revoked' => ['revoked_at' => now()],
                'expired' => ['expires_at' => now()->subSecond()],
                'expiry_equal' => ['expires_at' => now()],
                'session_version' => ['security_version' => 2],
                'foreign' => ['user_id' => $foreign->id],
                'freshness_old' => ['mfa_verified_at' => now()->subMinutes(30)],
                'freshness_null' => ['mfa_verified_at' => null],
                default => [],
            };
            if ($sessionChanges !== []) {
                DB::table('sessions')->where('id', $sessionId)->update($sessionChanges);
            }
            $credentialState = DB::table('users')->where('id', $owner->id)
                ->first(['password_hash', 'security_version', 'mfa_enabled', 'mfa_secret', 'recovery_codes']);
        });
        $this->postJson('/api/v1/auth/change-password', $this->payload($mfa))->assertStatus($status);
        $this->assertTrue($changed);
        $this->assertNotNull($credentialState);
        $this->assertEquals($credentialState, DB::table('users')->where('id', $owner->id)
            ->first(['password_hash', 'security_version', 'mfa_enabled', 'mfa_secret', 'recovery_codes']));
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertDatabaseCount('notifications', 0);
        $this->assertSame(0, DB::table('audit_events')->where('action', 'auth.password_change')->count());
        Queue::assertNothingPushed();
    }

    public static function commits(): array
    {
        return [[false], [true]];
    }

    #[DataProvider('commits')]
    public function test_outer_commit_owns_credentials_notice_revocation_and_audit(bool $commit): void
    {
        $owner = $this->owner();
        $current = $this->useSession($owner);
        $other = Ids::sha256Hex(SessionManager::create($owner->id, Request::create('/'), 1, true));
        $reset = Ids::sha256Hex(Ids::randomToken(32));
        DB::table('email_tokens')->insert(['id' => $reset, 'user_id' => $owner->id, 'kind' => 'reset', 'expires_at' => now()->addHour(), 'created_at' => now()]);
        $case = AccountRecoveryRequest::create(['user_id' => $owner->id, 'security_version' => 1, 'status' => 'requested', 'expires_at' => now()->addDay()]);
        $before = $owner->getRawOriginal();
        DB::beginTransaction();
        try {
            $this->postJson('/api/v1/auth/change-password', $this->payload())->assertOk()->assertExactJson(['ok' => true]);
            $this->assertSame(2, $owner->refresh()->security_version);
            $this->assertSame('cancelled', $case->refresh()->status);
            $this->assertDatabaseCount('mail_outbox', 1);
            $this->assertDatabaseCount('audit_outbox', 2);
            $actions = DB::table('audit_outbox')->pluck('event')
                ->map(static fn (string $event): string => json_decode($event, true, flags: JSON_THROW_ON_ERROR)['action'])
                ->sort()->values()->all();
            $this->assertSame(['auth.password_change', 'auth.security_notice_admitted'], $actions);
            $this->assertDatabaseCount('audit_events', 0);
            Queue::assertNothingPushed();
            if ($commit) {
                DB::commit();
            } else {
                DB::rollBack();
            }
        } finally {
            while (DB::transactionLevel() > 0) {
                DB::rollBack();
            }
        }
        if (! $commit) {
            $this->assertSame($before, $owner->refresh()->getRawOriginal());
            $this->assertSame('requested', $case->refresh()->status);
            $this->assertDatabaseHas('email_tokens', ['id' => $reset, 'used_at' => null]);
            $this->assertDatabaseCount('mail_outbox', 0);
            $this->assertDatabaseCount('audit_outbox', 0);
            $this->assertDatabaseCount('notifications', 0);
            Queue::assertNothingPushed();
            $this->postJson('/api/v1/auth/change-password', $this->payload())->assertOk();
        }
        $this->assertTrue(Hash::check(self::NEXT, $owner->refresh()->password_hash));
        $this->assertSame(2, $owner->security_version);
        $this->assertSame([], $owner->recovery_codes);
        $this->assertDatabaseHas('sessions', ['id' => $current, 'security_version' => 2, 'revoked_at' => null]);
        $this->assertNotNull(DB::table('sessions')->where('id', $other)->value('revoked_at'));
        $this->assertDatabaseMissing('email_tokens', ['id' => $reset]);
        $this->assertSame('cancelled', $case->refresh()->status);
        $this->assertDatabaseCount('mail_outbox', 1);
        $this->assertDatabaseCount('notifications', 1);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'auth.password_change')->count());
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
    }

    #[DataProvider('commits')]
    public function test_hash_is_computed_before_account_and_session_locks(bool $mfa): void
    {
        $owner = $this->owner($mfa);
        $sessionId = $this->useSession($owner);
        $driver = Hash::driver();
        $hashLevels = [];
        $hasher = \Mockery::mock(Hash::getFacadeRoot());
        Hash::swap($hasher);
        $hasher->shouldReceive('make')->once()->with(self::NEXT)
            ->andReturnUsing(static function (string $password) use ($driver, &$hashLevels): string {
                $hashLevels[] = DB::transactionLevel();

                return $driver->make($password);
            });
        $locks = [];
        DB::listen(static function (QueryExecuted $query) use (&$locks): void {
            if (str_contains($query->sql, 'for update')) {
                $locks[] = $query->sql;
            }
        });
        $this->postJson('/api/v1/auth/change-password', $this->payload($mfa))->assertOk();
        $this->assertSame([0], $hashLevels);
        $this->assertGreaterThanOrEqual(2, count($locks));
        $this->assertStringContainsString('"users"', $locks[0]);
        $this->assertStringContainsString('"sessions"', $locks[1]);
        $this->assertTrue($driver->check(self::NEXT, $owner->refresh()->password_hash));
        $this->assertDatabaseHas('sessions', ['id' => $sessionId, 'security_version' => 2, 'revoked_at' => null]);
        $event = DB::table('audit_events')->where('action', 'auth.password_change')->first();
        $this->assertNotNull($event);
        $this->assertSame($mfa ? 'recovery' : 'password_only', json_decode($event->metadata, true, flags: JSON_THROW_ON_ERROR)['factor']);
    }
}
