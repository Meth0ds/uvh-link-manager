<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * The user-facing half of the domain event fan-out.
 *
 * A custom domain going down takes every link on it with it, so the owner has
 * to hear about it without opening the panel: `domain.offline` reaches the
 * inbox of every owner/admin and the workspace owner's email. Everything else
 * is normal notification-centre traffic (immediate / daily digest / off, per
 * the user's preferences).
 *
 * Recipients are resolved at delivery time from live memberships: a person who
 * lost access before delivery must not learn about the domain, and one who
 * gained it should.
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
     * inbox with one line per revalidation.
     */
    private const SINGULAR = ['domain.offline', 'domain.recovered', 'domain.claim_transferred'];

    /**
     * @param  object{workspace_id: int|string, domain_id: int|string, domain: string, event: string}  $event
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

        // A displaced claim holder is told about the *loss*, from the point of
        // view of the workspace that no longer owns the name.
        $audienceWorkspace = $workspaceId;
        if ((string) $event->event === 'domain.claim_transferred') {
            $audienceWorkspace = (int) ($payload['previousWorkspaceId'] ?? $workspaceId);
        }

        $dedupeKey = in_array((string) $event->event, self::SINGULAR, true)
            ? null
            : sprintf('domain:%d:%s:%s', $domainId, $event->event, now()->format('Y-m-d'));
        $route = '/app/domains/'.$domainId;
        $subject = $domain;

        $immediate = false;
        foreach (self::recipients($audienceWorkspace) as $userId) {
            $delivery = NotificationInbox::record($userId, $kind, $audienceWorkspace, $subject, $dedupeKey, $route);
            $immediate = $immediate || $delivery === NotificationPreferences::DELIVERY_IMMEDIATE;
        }
        // The email is one message per event, not one per recipient: it goes to
        // the workspace owner because a domain outage is their problem first.
        if ($immediate && (string) $event->event === 'domain.offline') {
            self::emailOwner($audienceWorkspace, $domain, $domainId, (string) ($payload['reason'] ?? 'dns_failed'));
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

    private static function emailOwner(int $workspaceId, string $domain, int $domainId, string $reason): void
    {
        $ownerId = DB::table('workspaces')->where('id', $workspaceId)->value('owner_user_id');
        if ($ownerId === null) {
            return;
        }
        $user = User::where('id', (int) $ownerId)->whereNull('deleted_at')->first();
        if (! $user || $user->email === '') {
            return;
        }
        UvhMail::domainOffline($user->email, $domain, $domainId, self::reasonLabel($reason));
    }

    private static function reasonLabel(string $reason): string
    {
        return match ($reason) {
            'ownership_missing' => 'no encontramos el registro TXT de propiedad',
            'routing_missing' => 'el CNAME ya no apunta a UVH',
            'ownership_and_routing_missing' => 'faltan el TXT de propiedad y el CNAME',
            'claim_transferred' => 'la propiedad del dominio cambió de workspace',
            'resolver_unavailable' => 'no pudimos confirmar la configuración DNS',
            default => 'la configuración DNS dejó de ser válida',
        };
    }
}
