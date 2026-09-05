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
        // A caught PostgreSQL statement error still leaves the surrounding
        // transaction aborted. Audit is intentionally non-blocking, so defer
        // it until the business transaction has committed instead of creating
        // a hidden commit-time failure for moderation or lifecycle actions.
        if (DB::transactionLevel() > 0) {
            try {
                DB::afterCommit(static fn () => self::write(
                    $userId,
                    $action,
                    $resourceType,
                    $resourceId,
                    $metadata,
                    $ip,
                    $workspaceId,
                ));
            } catch (Throwable $e) {
                self::reportFailure($e, $userId, $action, $resourceType, $resourceId);
            }

            return;
        }

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
            $row = [
                'user_id' => $userId,
                'action' => $action,
                'resource_type' => $resourceType,
                'resource_id' => $resourceId !== null ? (string) $resourceId : null,
                'metadata' => $metadata !== null
                    ? json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)
                    : null,
                'ip_hash' => $ip ? UvhCrypto::hashIp($ip) : null,
                'created_at' => now(),
            ];
            // Global/legacy callers remain unattributed. A scoped insert must
            // fail visibly if 000033 is absent: never retry it without the scope.
            if ($workspaceId !== null) {
                $row['workspace_id'] = $workspaceId;
            }
            DB::table('audit_events')->insert($row);
        } catch (Throwable $e) {
            self::reportFailure($e, $userId, $action, $resourceType, $resourceId);
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
