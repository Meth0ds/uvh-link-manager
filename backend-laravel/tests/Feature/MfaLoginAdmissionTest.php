<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\Totp;
use App\Support\UvhCrypto;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class MfaLoginAdmissionTest extends TestCase
{
    private const SECRET = 'JBSWY3DPEHPK3PXP';

    private const CODE = 'ABCD2345EFGH6789';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        config(['cache.default' => 'array']);
        Cache::flush();
        $this->travelTo(now()->startOfSecond());
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'mfa-admission')->withHeaders(['X-CSRF-Token' => 'mfa-admission']);
    }

    private function fixture(): array
    {
        $user = User::factory()->create(['mfa_enabled' => true, 'mfa_secret' => UvhCrypto::encryptAtRest(self::SECRET), 'recovery_codes' => [Ids::sha256Hex(self::CODE)]]);
        $challenge = Ids::randomToken(24);
        Cache::put('uvh:mfa:challenge:'.Ids::sha256Hex($challenge), ['user_id' => $user->id, 'security_version' => 1], now()->addMinutes(5));

        return [$user, $challenge];
    }

    public static function accountRaces(): array
    {
        return ['version' => ['security_version', 2], 'block' => ['deleted_at', 'now'], 'verification' => ['email_verified_at', null], 'disabled' => ['mfa_enabled', false]];
    }

    #[DataProvider('accountRaces')]
    public function test_totp_revalidates_the_account_before_consuming_factor_and_granting_session(string $field, mixed $value): void
    {
        [$user, $challenge] = $this->fixture();
        $reads = 0;
        DB::listen(static function (QueryExecuted $query) use ($user, $field, $value, &$reads): void {
            if (str_starts_with(strtolower($query->sql), 'select') && str_contains($query->sql, 'from "users"') && ++$reads === 2) {
                // After the distributed-lock preflight read, before SQL's
                // authorization lock. The selected snapshot is already stale.
                DB::table('users')->where('id', $user->id)->update([$field => $value === 'now' ? now() : $value]);
            }
        });
        $code = (string) Totp::currentCode(self::SECRET);
        $this->postJson('/api/v1/auth/mfa/verify', ['challenge' => $challenge, 'code' => $code])->assertUnauthorized();
        $this->assertGreaterThanOrEqual(2, $reads);
        $this->assertDatabaseCount('sessions', 0);
        $counter = Totp::matchingCounter($code, self::SECRET);
        $this->assertFalse(Cache::has('uvh:mfa:totp-used:'.$user->id.':'.substr(hash('sha256', self::SECRET), 0, 24).':'.$counter));
    }

    public static function auditFailures(): array
    {
        $cases = [];
        foreach (['totp' => ['auth.login'], 'recovery' => ['auth.login', 'auth.mfa_recovery', 'auth.mfa_recovery_exhausted']] as $method => $events) {
            foreach ($events as $event) {
                foreach ([true, false] as $fail) {
                    $cases[$method.' '.$event.($fail ? ' admission' : ' history')] = [$method, $event, $fail];
                }
            }
        }

        return $cases;
    }

    #[DataProvider('accountRaces')]
    public function test_recovery_revalidates_the_account_before_spending_the_code(string $field, mixed $value): void
    {
        [$user, $challenge] = $this->fixture();
        $intercepted = false;
        DB::listen(static function (QueryExecuted $query) use ($user, $field, $value, &$intercepted): void {
            if (! $intercepted && str_starts_with(strtolower($query->sql), 'select') && str_contains($query->sql, 'from "users"') && ! str_contains($query->sql, 'for update')) {
                $intercepted = true;
                DB::table('users')->where('id', $user->id)->update([$field => $value === 'now' ? now() : $value]);
            }
        });
        $rejected = $this->postJson('/api/v1/auth/mfa/recovery', ['challenge' => $challenge, 'code' => self::CODE])->assertUnauthorized();
        $this->assertTrue($intercepted);
        $this->assertDatabaseCount('sessions', 0);
        $this->assertSame([Ids::sha256Hex(self::CODE)], $user->fresh()->recovery_codes);
        $this->assertFalse(Cache::has('uvh:mfa:challenge:'.Ids::sha256Hex($challenge).':consumed'));
        $this->assertSame(0, DB::table('audit_events')->where('action', 'auth.login')->count());
        $this->assertSame(0, (int) Cache::get('uvh:mfa:attempts:recovery:'.$user->id, 0));
        $this->assertSame(0, (int) Cache::get('uvh:mfa:attempts:global:'.$user->id, 0));
        $this->assertSame(0, DB::table('audit_events')->where('action', 'auth.mfa_failed')->count());
        $rejected->assertJsonPath('error', 'Sesión MFA caducada');
    }

    public static function factorMethods(): array
    {
        return [['totp'], ['recovery']];
    }

    #[DataProvider('factorMethods')]
    public function test_an_incorrect_factor_still_charges_its_purpose_and_the_global_budget(string $method): void
    {
        [$user, $challenge] = $this->fixture();
        $wrongTotp = '000000';
        while (Totp::matchingCounter($wrongTotp, self::SECRET) !== null) {
            $wrongTotp = sprintf('%06d', ((int) $wrongTotp + 1) % 1000000);
        }
        $this->postJson('/api/v1/auth/mfa/'.($method === 'totp' ? 'verify' : 'recovery'), ['challenge' => $challenge, 'code' => $method === 'totp' ? $wrongTotp : 'ZZZZ9999YYYY8888'])
            ->assertUnauthorized()->assertJsonPath('error', $method === 'totp' ? 'Código incorrecto' : 'Código de recuperación incorrecto');
        $this->assertSame(1, (int) Cache::get('uvh:mfa:attempts:'.$method.':'.$user->id, 0));
        $this->assertSame(1, (int) Cache::get('uvh:mfa:attempts:global:'.$user->id, 0));
        $this->assertSame(1, DB::table('audit_events')->where('action', 'auth.mfa_failed')->count());
        $this->assertSame(0, DB::table('audit_events')->where('action', 'auth.login')->count());
        $this->assertDatabaseCount('sessions', 0);
        $this->assertSame([Ids::sha256Hex(self::CODE)], $user->fresh()->recovery_codes);
        $this->assertFalse(Cache::has('uvh:mfa:challenge:'.Ids::sha256Hex($challenge).':consumed'));
    }

    #[DataProvider('factorMethods')]
    public function test_one_login_challenge_cannot_be_consumed_again_by_the_other_factor_method(string $firstMethod): void
    {
        [$user, $challenge] = $this->fixture();
        $totp = (string) Totp::currentCode(self::SECRET);
        $response = $this->postJson('/api/v1/auth/mfa/'.($firstMethod === 'totp' ? 'verify' : 'recovery'), ['challenge' => $challenge, 'code' => $firstMethod === 'totp' ? $totp : self::CODE])
            ->assertOk()->assertJsonPath('user.id', $user->id);
        $this->assertSame(['user'], array_keys($response->json()));
        foreach ([self::SECRET, self::CODE, $challenge] as $secret) {
            $this->assertStringNotContainsString($secret, $response->getContent());
        }
        $cookies = array_values(array_filter($response->headers->getCookies(), static fn ($cookie): bool => $cookie->getName() === 'uvh_session'));
        $this->assertCount(1, $cookies);
        $this->assertTrue($cookies[0]->isHttpOnly());
        $this->assertDatabaseHas('sessions', ['id' => Ids::sha256Hex($cookies[0]->getValue()), 'user_id' => $user->id, 'security_version' => 1]);
        $this->assertNotNull(DB::table('sessions')->value('mfa_verified_at'));
        $this->postJson('/api/v1/auth/mfa/'.($firstMethod === 'totp' ? 'recovery' : 'verify'), ['challenge' => $challenge, 'code' => $firstMethod === 'totp' ? self::CODE : $totp])
            ->assertUnauthorized()->assertJsonPath('error', 'Sesión MFA caducada');
        $this->assertDatabaseCount('sessions', 1);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'auth.login')->count());
        $this->assertSame($firstMethod === 'totp' ? [Ids::sha256Hex(self::CODE)] : [], $user->fresh()->recovery_codes);
    }

    public static function replayDirections(): array
    {
        return [['login-first'], ['stepup-first']];
    }

    #[DataProvider('replayDirections')]
    public function test_totp_replay_is_shared_between_login_and_authenticated_stepup(string $direction): void
    {
        [$user, $challenge] = $this->fixture();
        $password = 'orbit-copper-magnolia-73';
        $user->update(['password_hash' => Hash::make($password)]);
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), 1, true));
        $code = (string) Totp::currentCode(self::SECRET);
        if ($direction === 'login-first') {
            $this->postJson('/api/v1/auth/mfa/verify', ['challenge' => $challenge, 'code' => $code])->assertOk();
            $this->postJson('/api/v1/auth/mfa/reauthenticate', ['password' => $password, 'factorCode' => $code])->assertForbidden();
            $this->assertDatabaseCount('sessions', 2);
        } else {
            $this->postJson('/api/v1/auth/mfa/reauthenticate', ['password' => $password, 'factorCode' => $code])->assertOk();
            $this->postJson('/api/v1/auth/mfa/verify', ['challenge' => $challenge, 'code' => $code])->assertUnauthorized();
            $this->assertDatabaseCount('sessions', 1);
        }
        $counter = Totp::matchingCounter($code, self::SECRET);
        $this->assertTrue(Cache::has('uvh:mfa:totp-used:'.$user->id.':'.substr(hash('sha256', self::SECRET), 0, 24).':'.$counter));
    }

    public function test_cleanup_failure_keeps_the_consumed_marker_and_cannot_replay_with_recovery(): void
    {
        [$user, $challenge] = $this->fixture();
        $key = 'uvh:mfa:challenge:'.Ids::sha256Hex($challenge);
        $store = Cache::store();
        Cache::partialMock()->shouldReceive('forget')->with($key)->once()->andThrow(new \RuntimeException('Fixture: consumed challenge cleanup unavailable'));
        Cache::shouldReceive('store')->andReturn($store);
        Cache::shouldReceive('get')->andReturnUsing(static fn (...$args) => $store->get(...$args));
        Cache::shouldReceive('add')->andReturnUsing(static fn (...$args) => $store->add(...$args));
        Cache::shouldReceive('lock')->andReturnUsing(static fn (...$args) => $store->lock(...$args));
        $this->postJson('/api/v1/auth/mfa/verify', ['challenge' => $challenge, 'code' => (string) Totp::currentCode(self::SECRET)])
            ->assertStatus(503)->assertJsonMissingPath('user');
        $this->assertTrue($store->has($key.':consumed'));
        $this->assertTrue($store->has($key));
        $this->assertDatabaseCount('sessions', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->postJson('/api/v1/auth/mfa/recovery', ['challenge' => $challenge, 'code' => self::CODE])->assertUnauthorized();
        $this->assertSame([Ids::sha256Hex(self::CODE)], $user->refresh()->recovery_codes);
        $this->assertDatabaseCount('sessions', 0);
    }

    #[DataProvider('auditFailures')]
    public function test_mfa_exact_events_and_session_share_credential_commit(string $method, string $event, bool $fail): void
    {
        [$user, $challenge] = $this->fixture();
        if ($fail) {
            DB::listen(static function (QueryExecuted $query) use ($event): void {
                if (str_starts_with(strtolower($query->sql), 'insert') && str_contains($query->sql, '"audit_outbox"')) {
                    foreach ($query->bindings as $binding) {
                        if (is_string($binding) && str_contains($binding, '"action":"'.$event.'"')) {
                            throw new \RuntimeException('Fixture: exact MFA login admission interrupted');
                        }
                    }
                }
            });
        } else {
            Schema::rename('audit_events', 'audit_events_unavailable');
        }
        try {
            $response = $this->postJson('/api/v1/auth/mfa/'.($method === 'totp' ? 'verify' : 'recovery'), ['challenge' => $challenge, 'code' => $method === 'totp' ? (string) Totp::currentCode(self::SECRET) : self::CODE]);
            if ($fail) {
                $response->assertServerError();
                $this->assertDatabaseCount('sessions', 0);
                $this->assertDatabaseCount('audit_outbox', 0);
                $this->assertSame([Ids::sha256Hex(self::CODE)], $user->refresh()->recovery_codes);
                // Cache replay protection is not transactional and must stay consumed.
                $this->assertTrue(Cache::has('uvh:mfa:challenge:'.Ids::sha256Hex($challenge).':consumed'));
            } else {
                $response->assertOk();
                $this->assertDatabaseCount('sessions', 1);
                $events = DB::table('audit_outbox')->get()->map(static fn ($row) => json_decode($row->event, true, flags: JSON_THROW_ON_ERROR));
                $exact = $events->where('action', $event)->values();
                $this->assertCount(1, $exact);
                $this->assertSame($user->id, $exact[0]['user_id']);
                foreach ([self::SECRET, self::CODE, $challenge] as $secret) {
                    $this->assertStringNotContainsString($secret, json_encode($exact[0], JSON_THROW_ON_ERROR));
                }
            }
        } finally {
            if (! $fail) {
                Schema::rename('audit_events_unavailable', 'audit_events');
            }
        }
        if (! $fail) {
            $this->assertTrue(Audit::drain());
            $this->assertTrue(Audit::drain());
            $this->assertSame(1, DB::table('audit_events')->where('action', $event)->count());
        }
    }
}
