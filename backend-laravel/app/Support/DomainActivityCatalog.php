<?php

namespace App\Support;

/**
 * The public projection of a domain event payload.
 *
 * `GET /domains/{id}/activity` reads the same rows the outbox delivers, but
 * the raw payload is an *internal* record: it carries whatever the producer
 * needed (workspace ids of other tenants during a claim transfer, future
 * debugging fields). The timeline a member reads is a documented surface, so
 * it only ever sees the keys listed here, per event, with validated types —
 * never a field that was added to a payload by accident.
 */
final class DomainActivityCatalog
{
    /**
     * Event => allowed payload keys and their types. Everything else is
     * dropped by construction.
     *
     * @var array<string, array<string, 'integer'|'text'|'timestamp'>>
     */
    private const PROJECTION = [
        'domain.claim_transferred' => ['reason' => 'text'],
        'domain.degraded' => [
            'reason' => 'text',
            'failureCount' => 'integer',
            'graceExpiresAt' => 'timestamp',
        ],
        'domain.offline' => ['reason' => 'text'],
        'domain.tls_failed' => ['reason' => 'text'],
        'domain.tls_expiring' => [
            'notAfter' => 'timestamp',
            'daysRemaining' => 'integer',
        ],
    ];

    /**
     * @param  array<string, mixed>  $payload  the decoded producer payload
     * @return array<string, int|string> only the documented keys
     */
    public static function project(string $event, array $payload): array
    {
        $projected = [];
        foreach (self::PROJECTION[$event] ?? [] as $key => $type) {
            $value = $payload[$key] ?? null;
            if ($type === 'integer' && is_int($value) && $value >= 0) {
                $projected[$key] = $value;
            } elseif ($type === 'text' && is_string($value)
                && preg_match('/^[a-z0-9_]{1,64}$/D', $value) === 1) {
                // Reason codes are machine tokens (`routing_missing`), never
                // prose: a bounded, printable allowlist shape is enough.
                $projected[$key] = $value;
            } elseif ($type === 'timestamp' && is_string($value) && strlen($value) <= 64
                && strtotime($value) !== false) {
                $projected[$key] = $value;
            }
        }

        return $projected;
    }
}
