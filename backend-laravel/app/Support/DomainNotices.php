<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * The user-facing half of the domain event fan-out.
 *
 * A custom domain going down takes every link on it with it, so the owner has
 * to hear about it without opening the panel. Every domain notice obeys the
 * recipient's own notification preferences, uniformly and exactly:
 *
 *  - `immediate` — inbox row **and** mail now.
 *  - `daily_digest` — inbox row now, mail in the daily digest.
 *  - `in_app_only` — inbox row only.
 *  - `disabled` — nothing at all.
 *  - mandatory kinds (`domain_offline`, `domain_claim_transferred`) cannot be
 *    silenced: they behave as `immediate` for everyone.
 *
 * Recipients are resolved at delivery time from live memberships: a person who
 * lost access before delivery must not learn about the domain, and one who
 * gained it should. Each recipient gets their own mail — one message per
 * person per event, keyed by user and the outbox's stable event identity, so a
 * re-delivery can never mail anyone twice.
 */
final class DomainNotices
{
    private const KINDS = [
        'domain.degraded' => NotificationKinds::DOMAIN_DNS_DEGRADED,
        'domain.offline' => NotificationKinds::DOMAIN_OFFLINE,
        'domain.recovered' => NotificationKinds::DOMAIN_RECOVERED,
        'domain.tls_failed' => NotificationKinds::DOMAIN_TLS_FAILED,
        'domain.tls_expiring' => NotificationKinds::DOMAIN_TLS_EXPIRING,
        'domain.claim_transferred' => NotificationKinds::DOMAIN_CLAIM_TRANSFERRED,
    ];

    /**
     * Events that must never be collapsed: each occurrence is its own fact.
     * The rest dedupe per domain and day so a flapping DNS cannot flood an
     * inbox with one line per revalidation. Either way the outbox's stable
     * event identity participates: a re-delivery of the same event is the same
     * fact and must not duplicate the inbox row.
     */
    private const SINGULAR = ['domain.offline', 'domain.recovered', 'domain.claim_transferred'];

    /** Whether this event reaches the notification centre at all. */
    public static function handles(string $event): bool
    {
        return isset(self::KINDS[$event]);
    }

    /**
     * @param  object{workspace_id: int|string, domain_id: int|string, domain: string, event: string, event_uuid?: string}  $event
     * @param  array<string, mixed>  $payload
     */
    public static function deliver(object $event, array $payload): void
    {
        $kind = self::KINDS[(string) $event->event] ?? null;
        if ($kind === null) {
            return;
        }

        $workspaceId = (int) $event->workspace_id;
        $domainId = (int) $event->domain_id;
        $domain = (string) $event->domain;

        $dedupeKey = in_array((string) $event->event, self::SINGULAR, true)
            ? 'domain-event:'.((string) ($event->event_uuid ?? '') !== '' ? (string) $event->event_uuid : sprintf('%d:%s', $domainId, (string) $event->event))
            : sprintf('domain:%d:%s:%s', $domainId, $event->event, now()->format('Y-m-d'));
        $route = '/app/domains/'.$domainId;
        $subject = $domain;
        $reason = is_string($payload['reason'] ?? null) ? $payload['reason'] : '';

        foreach (self::recipients($workspaceId) as $userId) {
            $delivery = NotificationInbox::record($userId, $kind, $workspaceId, $subject, $dedupeKey, $route);
            // `record()` decides nothing about mail: the delivery it returns is
            // the recipient's preference (mandatory kinds always report
            // `immediate`), and only `immediate` mails now. A user who chose
            // `daily_digest` gets this in the digest; `in_app_only` and
            // `disabled` never leave the panel.
            if ($delivery === NotificationPreferences::DELIVERY_IMMEDIATE) {
                self::emailUser($userId, $kind, $domain, $domainId, $reason, (string) ($event->event_uuid ?? ''));
            }
        }
    }

    /** @return list<int> */
    private static function recipients(int $workspaceId): array
    {
        return DB::table('memberships')
            ->join('users', 'users.id', '=', 'memberships.user_id')
            ->where('memberships.workspace_id', $workspaceId)
            ->whereIn('memberships.role', ['owner', 'admin'])
            ->whereNull('users.deleted_at')
            ->orderBy('memberships.user_id')
            ->pluck('memberships.user_id')
            ->map(static fn ($id): int => (int) $id)
            ->all();
    }

    private static function emailUser(int $userId, string $kind, string $domain, int $domainId, string $reason, string $eventUuid): void
    {
        $user = User::where('id', $userId)->whereNull('deleted_at')->first();
        if (! $user || $user->email === '') {
            return;
        }
        UvhMail::domainNotice(
            $user->email,
            $kind,
            $domain,
            $domainId,
            self::reasonLabel($reason),
            $userId,
            $eventUuid !== '' ? $eventUuid : 'kind:'.$kind,
        );
    }

    private static function reasonLabel(string $reason): string
    {
        return match ($reason) {
            'ownership_missing' => 'no encontramos el registro TXT de propiedad',
            'routing_missing' => 'el CNAME ya no apunta a UVH',
            'ownership_and_routing_missing' => 'faltan el TXT de propiedad y el CNAME',
            'domain_claimed_elsewhere' => 'otro workspace ha probado la propiedad del dominio',
            'claim_transferred' => 'la propiedad del dominio cambió de workspace',
            'resolver_unavailable' => 'no pudimos confirmar la configuración DNS',
            'certificate_expired' => 'el certificado HTTPS ha caducado',
            'certificate_probe_failed' => 'el certificado HTTPS dejó de responder',
            default => 'la configuración DNS dejó de ser válida',
        };
    }
}
