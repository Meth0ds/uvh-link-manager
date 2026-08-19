<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Append-only audit trail. Records are never updated or deleted by the app.
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
    ): void {
        DB::table('audit_events')->insert([
            'user_id' => $userId,
            'action' => $action,
            'resource_type' => $resourceType,
            'resource_id' => $resourceId !== null ? (string) $resourceId : null,
            'metadata' => $metadata !== null ? json_encode($metadata, JSON_UNESCAPED_UNICODE) : null,
            'ip_hash' => $ip ? UvhCrypto::hashIp($ip) : null,
            'created_at' => now(),
        ]);
    }
}
