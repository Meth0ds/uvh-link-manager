<?php

namespace Tests\Feature;

use App\Cache\UvhRateLimiter;
use App\Support\UvhLimiters;
use Illuminate\Cache\Events\CacheFailedOver;
use Illuminate\Cache\RateLimiter;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
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

    private function attemptLogin(): TestResponse
    {
        return $this->postJson('/api/v1/auth/login', [
            'email' => 'budget@example.test',
            'password' => 'not-the-right-password',
            'captchaToken' => 'test-login-passcode',
        ]);
    }
}
