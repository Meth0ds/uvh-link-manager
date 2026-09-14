<?php

namespace Tests\Feature;

use App\Models\Link;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\OperationalMetrics;
use Illuminate\Cache\Events\CacheFailedOver;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\WithEnvironmentVariable;
use Tests\TestCase;

/**
 * Throttling is the one cache consumer that cannot be allowed to take the
 * public surface down with its backend. Production therefore counts attempts on
 * its own store, ordered Redis first and PostgreSQL second.
 *
 * Configuring that order is not the same as proving it serves traffic, so these
 * tests drive a real redirect with an unreachable preferred backend and assert
 * the response, the fallback event and where the attempt was finally counted.
 */
final class RateLimitFailoverTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // The limiter's own counter rows are truncated too: rate limit state is
        // deliberately shared between processes, which in a suite means it can
        // leak from one test class into another as a stray 429.
        DB::statement('TRUNCATE users, sessions, workspaces, audit_events, operational_metrics, cache RESTART IDENTITY CASCADE');
    }

    /**
     * Both values are set through the environment rather than through
     * `config()`. AppServiceProvider registers its named limiters during boot,
     * and doing that resolves the limiter singleton together with its store,
     * whose member list is read when the store is constructed. A configuration
     * change after boot is therefore ignored — and dropping the singleton to
     * force a re-resolution would drop every named limiter with it, turning
     * this test into a missing-limiter failure.
     */
    #[WithEnvironmentVariable('CACHE_LIMITER', 'failover')]
    #[WithEnvironmentVariable('CACHE_FAILOVER_STORES', 'redis,database')]
    public function test_a_redirect_is_served_when_the_rate_limit_backend_is_unreachable(): void
    {
        $this->pointPreferredLimiterStoreAtADeadEndpoint();

        $fallbacks = [];
        Event::listen(CacheFailedOver::class, function () use (&$fallbacks): void {
            $fallbacks[] = true;
        });

        [$owner, $workspace] = $this->workspace();
        $this->link($workspace, $owner, 'failover-alias');

        $response = $this->resolveAlias('failover-alias');

        $this->assertSame(302, $response->getStatusCode());
        $this->assertSame('https://example.test/failover-alias', $response->headers->get('Location'));
        // Without this the test would pass on a limiter that never contacted
        // the broken store, which would prove nothing about the fallback.
        $this->assertNotEmpty($fallbacks, 'the rate limiter never fell back to its second store');
        // Serving the redirect is only half of it: an attempt that is not
        // counted leaves the surface unlimited. The second store must be the
        // one that recorded it.
        $keys = DB::table('cache')->orderBy('key')->pluck('key')->all();
        $this->assertCount(2, $keys, 'expected exactly one counted attempt in the fallback store: '.json_encode($keys));
        // Laravel anchors each limiter window with a `:timer` sibling, so the
        // pair is the signature of a single counted attempt: no row would mean
        // nothing was counted, and a third row would mean something else used
        // the store under this test's feet.
        $this->assertSame($keys[0].':timer', $keys[1]);
    }

    /**
     * The container probe has to answer "can this process serve throttled
     * traffic?", not "is every backend healthy?". With the fallback in place
     * the answer is yes, and an orchestrator that removed the container would
     * be turning a degraded public surface into no public surface at all.
     */
    #[WithEnvironmentVariable('CACHE_LIMITER', 'failover')]
    #[WithEnvironmentVariable('CACHE_FAILOVER_STORES', 'redis,database')]
    public function test_a_degraded_rate_limit_store_keeps_the_container_in_rotation(): void
    {
        $this->pointPreferredLimiterStoreAtADeadEndpoint();

        $this->artisan('uvh:healthcheck', ['component' => 'app'])->assertExitCode(0);
    }

    public function test_the_fallback_is_observable(): void
    {
        // A silent degradation would hide a failing dependency. The listener is
        // what turns it into a counter, so its registration is part of the
        // contract; the series is exported beside every other one.
        $this->assertTrue(Event::hasListeners(CacheFailedOver::class));
        $this->assertContains('cache.failed_over', OperationalMetrics::ALLOWED);
    }

    private function pointPreferredLimiterStoreAtADeadEndpoint(): void
    {
        config([
            // The member list itself is not set here: it is fixed when the
            // store is built during boot, which is why the environment above
            // carries it instead. Only the endpoint is late-bound, because the
            // Redis connection is opened on first use.
            //
            // Loopback port 1 refuses a connection immediately, so this is a
            // real transport failure rather than a mocked exception, and it
            // cannot hang the suite on a black-holed address. `url` is cleared
            // because a configured REDIS_URL would override host and port.
            'database.redis.cache.url' => null,
            'database.redis.cache.host' => '127.0.0.1',
            'database.redis.cache.port' => 1,
            'database.redis.cache.password' => null,
        ]);
    }

    /** Resolve through the canonical public surface, as a real visitor does. */
    private function resolveAlias(string $alias): TestResponse
    {
        return $this->call('GET', 'http://'.config('uvh.public_host').'/'.$alias);
    }

    /** @return array{User, Workspace} */
    private function workspace(): array
    {
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Failover', 'slug' => 'failover-'.Ids::randomToken(8)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);

        return [$owner, $workspace];
    }

    private function link(Workspace $workspace, User $creator, string $alias): Link
    {
        return Link::create([
            'workspace_id' => $workspace->id,
            'created_by' => $creator->id,
            'alias' => $alias,
            'destination' => 'https://example.test/'.$alias,
        ]);
    }
}
