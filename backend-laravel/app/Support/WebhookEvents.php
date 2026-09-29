<?php

namespace App\Support;

/**
 * The single catalog of webhook events and their public projection.
 *
 * This is the only place that names a deliverable event. API validation, the
 * redacted delivery preview, the documented contract and the panel's picker
 * all derive from here (the frontend keeps its typed copy and a contract test
 * pins both sides together), so a new event can no longer exist in the
 * producer while the API silently rejects subscriptions to it.
 *
 * The projection is the *only* payload surface a receiver and the delivery
 * inspector ever see: values are copied from the producer payload by key and
 * type, and anything not listed here is dropped. Cross-tenant ids and future
 * internal fields cannot leak through a webhook by accident.
 */
final class WebhookEvents
{
    /**
     * Event name => allowed `data` keys and their types.
     *
     * @var array<string, array<string, 'integer'|'text'|'timestamp'>>
     */
    public const CATALOG = [
        'link.created' => ['linkId' => 'integer', 'alias' => 'text'],
        'link.updated' => ['linkId' => 'integer', 'alias' => 'text', 'state' => 'text'],
        'link.deleted' => ['linkId' => 'integer'],
        'link.threshold_reached' => ['linkId' => 'integer', 'threshold' => 'integer'],
        'domain.claimed' => ['domainId' => 'integer', 'domain' => 'text'],
        'domain.claim_transferred' => ['domainId' => 'integer', 'domain' => 'text', 'reason' => 'text'],
        'domain.verified' => ['domainId' => 'integer', 'domain' => 'text'],
        'domain.degraded' => [
            'domainId' => 'integer', 'domain' => 'text', 'reason' => 'text',
            'failureCount' => 'integer', 'graceExpiresAt' => 'timestamp',
        ],
        'domain.offline' => ['domainId' => 'integer', 'domain' => 'text', 'reason' => 'text'],
        'domain.recovered' => ['domainId' => 'integer', 'domain' => 'text'],
        'domain.activated' => ['domainId' => 'integer', 'domain' => 'text'],
        'domain.disabled' => ['domainId' => 'integer', 'domain' => 'text'],
        'domain.tls_failed' => ['domainId' => 'integer', 'domain' => 'text', 'reason' => 'text'],
        'domain.tls_expiring' => [
            'domainId' => 'integer', 'domain' => 'text',
            'notAfter' => 'timestamp', 'daysRemaining' => 'integer',
        ],
        'domain.deleted' => ['domainId' => 'integer', 'domain' => 'text'],
    ];

    /** The manual delivery test event; never subscribable, always inspectable. */
    public const PING = 'ping';

    /** @return list<string> */
    public static function all(): array
    {
        return array_keys(self::CATALOG);
    }

    public static function exists(string $event): bool
    {
        return isset(self::CATALOG[$event]);
    }

    /** @return array<string, 'integer'|'text'|'timestamp'> */
    public static function projection(string $event): array
    {
        return self::CATALOG[$event] ?? [];
    }
}
