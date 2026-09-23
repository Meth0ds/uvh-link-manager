<?php

namespace Tests\Feature;

use App\Cache\UvhRateLimiter;
use App\Models\User;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use App\Support\UvhLimiters;
use Illuminate\Cache\Events\CacheFailedOver;
use Illuminate\Cache\RateLimiter;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\WithEnvironmentVariable;
use Tests\TestCase;

/**
 * Two classes of limit, two stores.
 *
 * Availability limiters (`uvh-resolve`, `uvh-status`, …) keep the public
 * surface served, so they tolerate a degraded backend: the attempt lands on the
 * second member of the chain and the visitor gets their response. Credential
 * limiters bound guessing, and for them a second backend is not a fallback but
 * a second, empty window — an outage would grant a fresh budget and, when the
 * first backend returned, its older counters could block a legitimate account.
 *
 * These tests drive real requests and assert *where* each class counted.
 * Configuring the split is not the same as proving it.
 */
final class SecurityLimiterStoreTest extends TestCase
{
    private const CSRF = 'limiter-split-csrf';

    private const MFA_PASSWORD = 'tiovivo-cobrizo-astilla-42';

    protected function setUp(): void
    {
        parent::setUp();
        // The durable store is the one being inspected, so it starts empty.
        DB::statement('TRUNCATE cache RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', self::CSRF)->withHeaders(['X-CSRF-Token' => self::CSRF]);
    }

    /**
     * The binding, asserted directly.
     *
     * `Illuminate\Cache\CacheServiceProvider` is deferred, so its `register()`
     * runs lazily and rebinds the plain `RateLimiter` — this is the race that
     * silently defeats the split, because the middleware then falls back to the
     * availability store while everything still looks configured. The `throttle`
     * alias is covered behaviourally by the counting test below and at the
     * source level by `UvhLimitersTest`.
     */
    public function test_the_limiter_in_charge_is_the_one_that_can_split_the_stores(): void
    {
        $this->assertInstanceOf(UvhRateLimiter::class, app(RateLimiter::class));
    }

    public function test_a_credential_limiter_counts_on_the_security_store(): void
    {
        config(['cache.limiter_security' => 'database', 'uvh.rate_limits.auth' => 2]);

        $this->attemptLogin()->assertStatus(401);

        // Two limits guard a login (per address and per account), and each one
        // anchors its window with a `:timer` sibling: four rows is exactly one
        // counted attempt in the durable store. With the classification missing
        // the attempt would have gone to the availability store and this table
        // would still be empty.
        $keys = DB::table('cache')->pluck('key')->all();
        $this->assertCount(4, $keys, 'expected one counted attempt on the security store: '.json_encode($keys));
        $this->assertCount(2, array_filter($keys, fn (string $key): bool => str_ends_with($key, ':timer')));

        // And the budget is real: it is exhausted where it is counted.
        $this->attemptLogin()->assertStatus(401);
        $this->attemptLogin()->assertStatus(429);
    }

    public function test_an_availability_limiter_never_touches_the_security_store(): void
    {
        config(['cache.limiter_security' => 'database']);

        // `throttle:uvh-status` bounds traffic, not a credential: it must stay
        // on the availability store even when the security one is configured.
        $this->getJson('/api/v1/status')->assertOk();

        $this->assertSame(0, DB::table('cache')->count(), 'a volume limiter counted on the credential store');
    }

    /**
     * An empty value inherits the default store, as `.env.example` documents it.
     *
     * The key ships *present but empty* there, and the cache manager falls back
     * on the default for `null` alone — Laravel 13 resolves it with
     * `enum_value($name) ??`, not `?:`. The empty string therefore reached
     * `resolve('')`, which throws `Cache store [] is not defined` while
     * `AppServiceProvider::boot()` is still registering the named limiters. The
     * application did not boot at all: `artisan` was unusable and
     * `composer install` failed in its own `post-autoload-dump` script.
     *
     * CI never saw it because it runs *without* a `.env`, where the key is
     * absent — and absent is `null`, which the manager does fall back on. The
     * documented local flow, `cp .env.example .env`, is the one that always hit
     * it: with the shipped value this whole suite fails to boot before the fix,
     * which is the reproduction. The assertions below pin the translation that
     * stops it, and they have to be assertions rather than another
     * `#[WithEnvironmentVariable]` case: PHPUnit treats an empty value as
     * "unset", and unset is precisely the shape that never failed.
     */
    public function test_an_empty_limiter_store_inherits_the_default_one(): void
    {
        config(['cache.default' => 'database', 'cache.limiter' => '']);

        $this->assertSame('database', UvhLimiters::availabilityStore());

        // A line holding only spaces is the same accident as an empty one.
        config(['cache.limiter' => '   ']);
        $this->assertSame('database', UvhLimiters::availabilityStore());

        // And a configured store always wins over the default.
        config(['cache.limiter' => 'array']);
        $this->assertSame('array', UvhLimiters::availabilityStore());
    }

    /**
     * The property that motivated the split, exercised end to end: the
     * availability chain goes down and the credential budget is exactly where
     * it was.
     */
    #[WithEnvironmentVariable('CACHE_LIMITER', 'failover')]
    #[WithEnvironmentVariable('CACHE_FAILOVER_STORES', 'redis,database')]
    public function test_a_credential_budget_survives_the_availability_store_falling_over(): void
    {
        config(['cache.limiter_security' => 'database', 'uvh.rate_limits.auth' => 2]);

        $this->attemptLogin()->assertStatus(401);
        $this->attemptLogin()->assertStatus(401);
        $this->attemptLogin()->assertStatus(429);

        // The preferred member of the availability chain dies. It is the same
        // transport failure the failover drill uses: loopback port 1 refuses
        // immediately, so it cannot hang the suite.
        $fallbacks = [];
        Event::listen(CacheFailedOver::class, function () use (&$fallbacks): void {
            $fallbacks[] = true;
        });
        config([
            'database.redis.cache.url' => null,
            'database.redis.cache.host' => '127.0.0.1',
            'database.redis.cache.port' => 1,
            'database.redis.cache.password' => null,
        ]);

        // Not a fresh window: the counter lives in the durable store, so the
        // third failed attempt is still the third.
        $this->attemptLogin()->assertStatus(429);

        // And the credential path never consulted the chain at all — had it
        // done so, this request would have started from zero and been admitted.
        $this->assertSame([], $fallbacks, 'the credential limiter consulted the availability chain');
    }

    public function test_an_unconfigured_security_store_still_limits_on_the_availability_one(): void
    {
        // Non-production environments, and any deployment that has not adopted
        // the split, must keep working as before — and must not fail open.
        // `null` means "use the availability store", never "count nowhere".
        config(['cache.limiter_security' => null, 'uvh.rate_limits.auth' => 1]);
        $this->assertNull(UvhLimiters::securityStore());

        $this->attemptLogin()->assertStatus(401);
        $this->attemptLogin()->assertStatus(429);
    }

    /**
     * The account-wide step-up budget (`MfaAttempts`) is not a middleware
     * limiter, and the global `RateLimiter` facade it once counted on is bound
     * to the availability store on purpose. Its counters must land on the
     * security store like every other credential budget — and stay exactly
     * there while the availability chain is down.
     */
    #[WithEnvironmentVariable('CACHE_LIMITER', 'failover')]
    #[WithEnvironmentVariable('CACHE_FAILOVER_STORES', 'redis,database')]
    public function test_the_mfa_attempt_budget_counts_on_the_security_store(): void
    {
        config(['cache.limiter_security' => 'database']);
        $user = $this->mfaUser();
        $this->useSession($user);

        // The preferred member of the availability chain dies first, exactly
        // like the failover drill: loopback port 1 refuses immediately.
        $fallbacks = [];
        Event::listen(CacheFailedOver::class, function () use (&$fallbacks): void {
            $fallbacks[] = true;
        });
        config([
            'database.redis.cache.url' => null,
            'database.redis.cache.host' => '127.0.0.1',
            'database.redis.cache.port' => 1,
            'database.redis.cache.password' => null,
        ]);

        for ($attempt = 0; $attempt < 3; $attempt++) {
            $this->attemptStepUpFailure()->assertStatus(403);
        }

        // One purpose counter and one account-wide counter, each with its
        // window anchor, hit once per failure: four rows in the durable store,
        // exactly where an outage cannot reset them. Counting on the facade
        // would have left this table empty — the test cache is not the durable
        // store.
        // The store prefixes its rows, so the counters are located by their own
        // marker rather than by a literal row name.
        $keys = DB::table('cache')->pluck('key')->all();
        $budget = [];
        foreach ($keys as $key) {
            $position = strpos($key, 'uvh:mfa:attempts:');
            if ($position !== false) {
                $budget[] = substr($key, $position);
            }
        }
        sort($budget);
        $this->assertSame([
            'uvh:mfa:attempts:global:'.$user->id,
            'uvh:mfa:attempts:global:'.$user->id.':timer',
            'uvh:mfa:attempts:stepup:'.$user->id,
            'uvh:mfa:attempts:stepup:'.$user->id.':timer',
        ], $budget, 'the MFA attempt budget did not count on the security store: '.json_encode($keys));

        // And the credential path never consulted the availability chain: had
        // it done so, these failures would have started from zero on the
        // failover store and a failover event would have been recorded.
        $this->assertSame([], $fallbacks, 'the MFA attempt budget consulted the availability chain');
    }

    /** An MFA account whose factor can only fail, for the budget probes. */
    private function mfaUser(): User
    {
        $user = User::factory()->create(['password_hash' => Hash::make(self::MFA_PASSWORD)]);
        $user->forceFill([
            'email_verified_at' => now(),
            'mfa_enabled' => true,
            'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP'),
            // Never present in any probe below, so no attempt can succeed.
            'recovery_codes' => [Ids::sha256Hex('ABCDEFGH2345678J')],
        ])->save();

        return $user->refresh();
    }

    /** A distinct real session row, hydrated exactly like the middleware does. */
    private function useSession(User $user): void
    {
        $token = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, mfaVerified: true);
        $this->withCookie('uvh_session', $token);
    }

    private function attemptStepUpFailure(): TestResponse
    {
        return $this->postJson('/api/v1/auth/mfa/recovery-codes/regenerate', [
            'password' => self::MFA_PASSWORD,
            'factorCode' => 'ZZZZZZZZ2222YYYY',
        ]);
    }

    private function attemptLogin(): TestResponse
    {
        return $this->postJson('/api/v1/auth/login', [
            'email' => 'budget@example.test',
            'password' => 'not-the-right-password',
            'captchaToken' => 'test-login-passcode',
        ]);
    }
}
