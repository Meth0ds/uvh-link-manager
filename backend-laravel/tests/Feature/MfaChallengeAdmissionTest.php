<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\UvhCrypto;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class MfaChallengeAdmissionTest extends TestCase
{
    private const PASSWORD = 'orbit-copper-magnolia-73';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        config(['cache.default' => 'array']);
        Cache::flush();
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'challenge')->withHeader('X-CSRF-Token', 'challenge');
    }

    private function account(): User
    {
        return User::factory()->create(['password_hash' => Hash::make(self::PASSWORD), 'mfa_enabled' => true, 'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP'), 'recovery_codes' => [Ids::sha256Hex('ABCD2345EFGH6789')]]);
    }

    private function login(User $user)
    {
        return $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => self::PASSWORD, 'captchaToken' => 'fixture']);
    }

    public static function races(): array
    {
        return ['version' => ['security_version', 2], 'blocked' => ['deleted_at', 'now'], 'unverified' => ['email_verified_at', null], 'MFA disabled without version' => ['mfa_enabled', false], 'hash replaced without version' => ['password_hash', 'different-hash'], 'email changed without version' => ['email', 'changed@example.test']];
    }

    #[DataProvider('races')]
    public function test_a_stale_password_preflight_cannot_issue_a_challenge(string $field, mixed $value): void
    {
        $user = $this->account();
        Hash::partialMock()->shouldReceive('check')->once()->andReturnUsing(static function () use ($user, $field, $value): bool {
            DB::table('users')->where('id', $user->id)->update([$field => $value === 'now' ? now() : $value]);

            return true;
        });
        $this->login($user)->assertUnauthorized()->assertJsonMissingPath('challenge');
        $this->assertDatabaseCount('sessions', 0);
        $this->assertSame(0, DB::table('audit_events')->where('action', 'auth.mfa_challenge_issued')->count());
    }

    public function test_recovery_availability_comes_from_the_locked_account(): void
    {
        $user = $this->account();
        Hash::partialMock()->shouldReceive('check')->once()->andReturnUsing(static function () use ($user): bool {
            DB::table('users')->where('id', $user->id)->update(['recovery_codes' => null]);

            return true;
        });
        $this->login($user)->assertOk()->assertJsonPath('mfaRequired', true)->assertJsonPath('recoveryAvailable', false);
    }

    public static function auditCases(): array
    {
        return ['admission' => [true], 'history' => [false]];
    }

    #[DataProvider('auditCases')]
    public function test_challenge_is_not_published_without_its_exact_event(bool $fail): void
    {
        $user = $this->account();
        if ($fail) {
            DB::listen(static function (QueryExecuted $query): void {
                if (str_starts_with(strtolower($query->sql), 'insert') && str_contains($query->sql, '"audit_outbox"')) {
                    foreach ($query->bindings as $binding) {
                        if (is_string($binding) && str_contains($binding, '"action":"auth.mfa_challenge_issued"')) {
                            throw new \RuntimeException('Fixture: challenge admission unavailable');
                        }
                    }
                }
            });
        } else {
            Schema::rename('audit_events', 'audit_events_unavailable');
        }
        try {
            $response = $this->login($user);
            if ($fail) {
                $response->assertServerError()->assertJsonMissingPath('challenge');
                $this->assertDatabaseCount('audit_outbox', 0);
            } else {
                $response->assertOk()->assertJsonPath('mfaRequired', true);
                $challenge = $response->json('challenge');
                $this->assertSame(['user_id' => $user->id, 'security_version' => 1], Cache::get('uvh:mfa:challenge:'.Ids::sha256Hex($challenge)));
                $events = DB::table('audit_outbox')->get()->map(static fn ($row) => json_decode($row->event, true, flags: JSON_THROW_ON_ERROR));
                $this->assertCount(1, $events->where('action', 'auth.mfa_challenge_issued'));
                $this->assertStringNotContainsString($challenge, json_encode($events, JSON_THROW_ON_ERROR));
            }
            $this->assertDatabaseCount('sessions', 0);
        } finally {
            if (! $fail) {
                Schema::rename('audit_events_unavailable', 'audit_events');
            }
        }
        if (! $fail) {
            $this->assertTrue(Audit::drain());
            $this->assertTrue(Audit::drain());
            $this->assertSame(1, DB::table('audit_events')->where('action', 'auth.mfa_challenge_issued')->count());
        }
    }

    public static function cacheFailures(): array
    {
        return ['before write' => [false], 'after write' => [true]];
    }

    #[DataProvider('cacheFailures')]
    public function test_cache_admission_failure_does_not_publish_a_challenge_or_its_event(bool $afterWrite): void
    {
        $user = $this->account();
        $store = Cache::store();
        $writtenKey = null;
        Cache::partialMock()->shouldReceive('put')->withArgs(static fn ($key) => str_starts_with($key, 'uvh:mfa:challenge:'))
            ->andReturnUsing(static function ($key, $value, $ttl) use ($store, $afterWrite, &$writtenKey): void {
                if ($afterWrite) {
                    $store->put($key, $value, $ttl);
                    $writtenKey = $key;
                }
                throw new \RuntimeException('Fixture: cache unavailable');
            });
        // partialMock replaces the manager; route cleanup to the same concrete
        // repository used by the injected write and assert its exact key.
        Cache::shouldReceive('forget')->once()->withArgs(static function ($key) use ($afterWrite, &$writtenKey): bool {
            return ! $afterWrite || $key === $writtenKey;
        })
            ->andReturnUsing(static fn ($key) => $store->forget($key));
        $this->login($user)->assertStatus(503)->assertJsonMissingPath('challenge');
        $this->assertSame(0, DB::table('audit_events')->where('action', 'auth.mfa_challenge_issued')->count());
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('sessions', 0);
        if ($afterWrite) {
            $this->assertNotNull($writtenKey);
            $this->assertNull($store->get($writtenKey));
        }
    }
}
