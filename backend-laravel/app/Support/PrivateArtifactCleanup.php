<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/** Recoverable deletion for encrypted account-export artifacts. */
final class PrivateArtifactCleanup
{
    /**
     * Delete one internally generated artifact and clear its pointer only
     * after storage confirms that the file no longer exists.
     */
    public static function attempt(int $requestId, mixed $path): bool
    {
        if (! is_string($path) || $path === '') {
            return true;
        }
        if (! self::isManagedPath($path)) {
            OperationalMetrics::increment('export.cleanup_failed');
            Log::warning('Rejected invalid private export artifact path', [
                'request_id' => $requestId,
            ]);

            return false;
        }

        try {
            DB::transaction(function () use ($requestId, $path): void {
                // Serialize with downloads, cancellation and APP_SECRET
                // rotation before touching the concrete file.
                $row = DB::table('data_export_requests')->where('id', $requestId)
                    ->lockForUpdate()->first(['id', 'artifact_path']);
                $disk = Storage::disk('local');
                if ($disk->exists($path) && ! $disk->delete($path)) {
                    throw new \RuntimeException('Private export artifact deletion was rejected');
                }

                if ($row && is_string($row->artifact_path) && hash_equals($path, $row->artifact_path)) {
                    DB::table('data_export_requests')->where('id', $requestId)
                        ->where('artifact_path', $path)
                        ->update(['artifact_path' => null, 'updated_at' => now()]);
                }
            }, 3);
            OperationalMetrics::increment('export.cleaned');

            return true;
        } catch (\Throwable $error) {
            OperationalMetrics::increment('export.cleanup_failed');
            Log::warning('Private export artifact cleanup failed', [
                'request_id' => $requestId,
                'exception' => $error::class,
            ]);

            return false;
        }
    }

    /** Retry a bounded set left by requests, workers or storage outages. */
    public static function retryTerminal(int $limit = 100): int
    {
        $rows = DB::table('data_export_requests')
            ->whereIn('status', ['downloaded', 'failed', 'cancelled', 'expired'])
            ->whereNotNull('artifact_path')
            ->orderBy('updated_at')
            ->orderBy('id')
            ->limit(max(1, min($limit, 500)))
            ->get(['id', 'artifact_path']);

        $cleaned = 0;
        foreach ($rows as $row) {
            if (self::attempt((int) $row->id, $row->artifact_path)) {
                $cleaned++;
            }
        }

        return $cleaned;
    }

    public static function isManagedPath(mixed $path): bool
    {
        return is_string($path)
            && preg_match('#^account-exports/[A-Za-z0-9_-]{32}\.uvh$#D', $path) === 1;
    }
}
