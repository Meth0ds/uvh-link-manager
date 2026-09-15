<?php

namespace App\Console\Commands;

use App\Support\ReleaseReadiness;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** Container-local liveness/readiness check with shared-state heartbeats. */
final class UvhHealthcheck extends Command
{
    protected $signature = 'uvh:healthcheck {component : app, scheduler, queue or queue-<pool>}';

    protected $description = 'Check UVH database/cache readiness and process heartbeats';

    public function handle(): int
    {
        $component = (string) $this->argument('component');
        if (! in_array($component, ['app', 'queue', 'scheduler'], true)
            && preg_match('/^queue-[a-z0-9-]{1,32}$/D', $component) !== 1) {
            return self::INVALID;
        }

        try {
            DB::select('SELECT 1');
            // Connectivity is insufficient when this image needs a newer schema.
            // Keep checking after startup so missing/restored tables lose readiness.
            if (ReleaseReadiness::errors() !== []) {
                return self::FAILURE;
            }
            if ($component === 'app') {
                // Probe the store this process actually promises to serve
                // traffic on: the rate limiter's store when one is configured.
                // Production points that store at a failover chain (Redis, then
                // PostgreSQL), so a Redis outage the application is designed to
                // ride out must not take the container out of rotation and turn
                // a degraded public surface into no public surface at all.
                //
                // The degradation is not hidden by this: every actual fallback
                // is counted as `cache.failed_over`, and a deployment that runs
                // without a fallback store still fails this probe when its only
                // store is gone, which is the honest answer for it.
                //
                // Credential limiters count on `cache.limiter_security`
                // instead. It is deliberately NOT probed here: the shipped
                // value is the database, whose availability the `SELECT 1`
                // above already requires and whose failure is already fatal
                // for the whole process, and failing the container for a
                // credential-counter store would turn a degraded public
                // surface into no public surface at all. A deployment that
                // points that setting at another backend must alert on it
                // separately.
                $limiterStore = config('cache.limiter');
                $store = Cache::store(is_string($limiterStore) && $limiterStore !== '' ? $limiterStore : null);
                $probe = 'uvh:health:probe:'.bin2hex(random_bytes(12));
                $healthy = $store->put($probe, 'ok', 30) && hash_equals('ok', (string) $store->pull($probe));

                return $healthy ? self::SUCCESS : self::FAILURE;
            }

            $heartbeat = Cache::get('uvh:health:'.$component);
            if (! is_int($heartbeat) && ! (is_string($heartbeat) && ctype_digit($heartbeat))) {
                return self::FAILURE;
            }
            $maxAge = str_starts_with($component, 'queue') ? 180 : 210;

            return time() - (int) $heartbeat <= $maxAge ? self::SUCCESS : self::FAILURE;
        } catch (\Throwable) {
            return self::FAILURE;
        }
    }
}
