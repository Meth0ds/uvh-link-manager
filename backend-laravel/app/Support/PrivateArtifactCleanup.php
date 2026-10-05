<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/** Recoverable deletion for encrypted account-export artifacts. */
final class PrivateArtifactCleanup
{
    /** Business callers schedule deletion only after their outer commit. */
    public static function afterCommit(int $requestId, mixed $path): void
    {
        if (! is_string($path) || $path === '') {
            return;
        }
        try {
            if (DB::transactionLevel() > 0) {
                DB::afterCommit(static fn () => self::clean($requestId, $path, true));
            } else {
                self::clean($requestId, $path, true);
            }
        } catch (\Throwable $error) {
            // The committed terminal row retains the concrete retry pointer.
            self::reportFailure($requestId, $error);
        }
    }

    /**
     * Delete one internally generated artifact and clear its pointer only
     * after storage confirms that the file no longer exists.
     */
    public static function attempt(int $requestId, mixed $path): bool
    {
        // Workers require the actual outcome before registering another path.
        return self::clean($requestId, $path, false);
    }

    private static function clean(int $requestId, mixed $path, bool $terminalOnly): bool
    {
        if (! is_string($path) || $path === '') {
            return true;
        }
        if (! self::isManagedPath($path)) {
            self::reportFailure($requestId, null);

            return false;
        }

        try {
            $cleaned = DB::transaction(function () use ($requestId, $path, $terminalOnly): bool {
                // Serialize with downloads, cancellation and APP_SECRET
                // rotation before touching the concrete file.
                $row = DB::table('data_export_requests')->where('id', $requestId)
                    ->lockForUpdate()->first(['id', 'artifact_path', 'status']);
                // A callback or retry selection may be stale. Revalidate under
                // the same row lock that protects downloads and rotation.
                if ($terminalOnly && (! $row
                    || ! in_array($row->status, ['downloaded', 'failed', 'cancelled', 'expired'], true)
                    || ! is_string($row->artifact_path)
                    || ! hash_equals($path, $row->artifact_path))) {
                    return false;
                }
                $disk = Storage::disk('local');
                if ($disk->exists($path) && ! $disk->delete($path)) {
                    throw new \RuntimeException('Private export artifact deletion was rejected');
                }

                if ($row && is_string($row->artifact_path) && hash_equals($path, $row->artifact_path)) {
                    DB::table('data_export_requests')->where('id', $requestId)
                        ->where('artifact_path', $path)
                        ->update(['artifact_path' => null, 'updated_at' => now()]);
                }

                return true;
            }, 3);
            if ($cleaned) {
                OperationalMetrics::increment('export.cleaned');
            }

            return $cleaned;
        } catch (\Throwable $error) {
            self::reportFailure($requestId, $error);

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
            if (DB::transactionLevel() > 0) {
                // A sweep may see a terminal transition in an enclosing
                // transaction. Defer and revalidate that exact pointer, just
                // like business callers; scheduled work is not yet cleaned.
                self::afterCommit((int) $row->id, $row->artifact_path);

                continue;
            }
            if (self::clean((int) $row->id, $row->artifact_path, true)) {
                $cleaned++;
            }
        }

        return $cleaned;
    }

    private static function reportFailure(int $requestId, ?\Throwable $error): void
    {
        OperationalMetrics::increment('export.cleanup_failed');
        try {
            Log::warning($error === null
                ? 'Rejected invalid private export artifact path'
                : 'Private export artifact cleanup failed', [
                    'request_id' => $requestId,
                    'exception' => $error !== null ? $error::class : null,
                ]);
        } catch (\Throwable) {
            // Auxiliary diagnostics cannot reject an already committed action.
        }
    }

    public static function isManagedPath(mixed $path): bool
    {
        return is_string($path)
            && preg_match('#^account-exports/[A-Za-z0-9_-]{32}\.uvh$#D', $path) === 1;
    }
}
