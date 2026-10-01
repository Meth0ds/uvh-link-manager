<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Append-only writer; retention and account lifecycle may remove old records.
 * Never log tokens, passwords, cookies or sensitive query strings.
 */
class Audit
{
    public static function write(
        ?int $userId = null,
        ?string $action = null,
        ?string $resourceType = null,
        int|string|null $resourceId = null,
        ?array $metadata = null,
        ?string $ip = null,
        ?int $workspaceId = null,
    ): void {
        try {
            // Only an explicit resource identity can establish attribution.
            // Never look up a deleted child, read request headers, infer from
            // actor memberships, or trust a workspaceId inside metadata.
            if ($resourceType === 'workspace') {
                $resourceWorkspaceId = filter_var($resourceId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
                if ($resourceWorkspaceId === false || ($workspaceId !== null && $workspaceId !== $resourceWorkspaceId)) {
                    throw new \InvalidArgumentException('Inconsistent audit workspace identity');
                }
                $workspaceId = $resourceWorkspaceId;
            }
            if ($workspaceId !== null && $workspaceId < 1) {
                throw new \InvalidArgumentException('Invalid audit workspace identity');
            }
            if (RequestTrace::current() !== null) {
                $metadata = [...($metadata ?? []), 'correlation_id' => RequestTrace::current()];
            }
            $row = [
                'user_id' => $userId,
                'action' => $action,
                'resource_type' => $resourceType,
                'resource_id' => $resourceId !== null ? (string) $resourceId : null,
                'metadata' => $metadata !== null
                    ? json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)
                    : null,
                'ip_hash' => $ip ? UvhCrypto::hashIp($ip) : null,
                'created_at' => now()->toIso8601String(),
            ];
            // Global/legacy callers remain unattributed. A scoped insert must
            // fail visibly if 000033 is absent: never retry it without the scope.
            if ($workspaceId !== null) {
                $row['workspace_id'] = $workspaceId;
            }
            $admit = static function () use ($row): void {
                $id = DB::table('audit_outbox')->insertGetId([
                    'event' => json_encode($row, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                    'created_at' => now(),
                ]);
                // The durable row exists in the business commit. A crash before
                // this optimization is harmless: housekeeping recovers it.
                DB::afterCommit(static fn () => self::drain($id));
            };
            if (DB::transactionLevel() > 0) {
                $admit();
            } else {
                DB::transaction($admit);
            }
        } catch (Throwable $e) {
            self::reportFailure($e, $userId, $action, $resourceType, $resourceId);
            if (DB::transactionLevel() > 0) {
                // A mutation cannot commit after durable audit admission failed.
                throw $e;
            }
        }
    }

    /** Materialize a bounded batch atomically; a failed insert keeps the event retryable. */
    public static function drain(?int $id = null): bool
    {
        try {
            DB::transaction(static function () use ($id): void {
                $query = DB::table('audit_outbox')->orderBy('id')->limit(100)->lock('FOR UPDATE SKIP LOCKED');
                if ($id !== null) {
                    $query->where('id', $id);
                }
                foreach ($query->get() as $pending) {
                    $row = json_decode($pending->event, true, 32, JSON_THROW_ON_ERROR);
                    // Match audit_events' ON DELETE SET NULL contract even when
                    // account deletion committed before this recovery pass.
                    if ($row['user_id'] !== null && ! DB::table('users')->where('id', $row['user_id'])->exists()) {
                        $row['user_id'] = null;
                    }
                    DB::table('audit_events')->insert($row);
                    DB::table('audit_outbox')->where('id', $pending->id)->delete();
                }
            });

            return true;
        } catch (Throwable $error) {
            self::reportFailure($error, null, 'audit.materialization_failed', 'audit', $id);

            return false;
        }
    }

    private static function reportFailure(
        Throwable $error,
        ?int $userId,
        ?string $action,
        ?string $resourceType,
        int|string|null $resourceId,
    ): void {
        OperationalMetrics::increment('audit.write_failed');
        // Re-throwing would report a false failure for an already committed
        // operation. Emit a metadata-free fallback signal; never copy secrets
        // or arbitrary request data.
        try {
            Log::critical('[audit] durable write failed', [
                'user_id' => $userId,
                'action' => $action,
                'resource_type' => $resourceType,
                'resource_id' => $resourceId !== null ? (string) $resourceId : null,
                'exception' => $error::class,
            ]);
        } catch (Throwable) {
            // A broken log transport must not alter an already committed
            // user-facing operation either.
        }
    }
}
