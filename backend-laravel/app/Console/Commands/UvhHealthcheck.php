<?php

namespace App\Console\Commands;

use App\Support\ReleaseReadiness;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** Container-local liveness/readiness check with shared-state heartbeats. */
final class UvhHealthcheck extends Command
{
    protected $signature = 'uvh:healthcheck {component : app, queue or scheduler}';

    protected $description = 'Check UVH database/cache readiness and process heartbeats';

    public function handle(): int
    {
        $component = (string) $this->argument('component');
        if (! in_array($component, ['app', 'queue', 'scheduler'], true)) {
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
                $probe = 'uvh:health:probe:'.bin2hex(random_bytes(12));
                Cache::put($probe, 'ok', 30);
                $healthy = hash_equals('ok', (string) Cache::pull($probe));

                return $healthy ? self::SUCCESS : self::FAILURE;
            }

            $heartbeat = Cache::get('uvh:health:'.$component);
            if (! is_int($heartbeat) && ! (is_string($heartbeat) && ctype_digit($heartbeat))) {
                return self::FAILURE;
            }
            $maxAge = $component === 'queue' ? 180 : 210;

            return time() - (int) $heartbeat <= $maxAge ? self::SUCCESS : self::FAILURE;
        } catch (\Throwable) {
            return self::FAILURE;
        }
    }
}
