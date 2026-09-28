<?php

namespace App\Support;

use App\Models\CustomDomain;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;

/**
 * The single place that knows what a custom domain's status means.
 *
 * Four facts are stored — what the user wants (`desired_state`), who owns the
 * name (`ownership_status`), whether the CNAME points here (`routing_status`)
 * and the certificate (`tls_status`) — and everything a human sees is derived
 * from them here: serving state, the grace deadline, and the legacy `state`
 * label the public API still carries during its compatibility window.
 *
 * Every multi-column transition also lives here as a write payload, so the
 * controller, the DNS job, the TLS job and the housekeeping sweeps cannot
 * drift apart about what e.g. "disabled" changes.
 */
final class DomainStatus
{
    public const TRAFFIC_ONLINE = 'online';

    public const TRAFFIC_DEGRADED = 'degraded';

    public const TRAFFIC_PROVISIONING = 'provisioning';

    public const TRAFFIC_OFFLINE = 'offline';

    /** Whether a DNS check is currently running for this row. */
    public static function dnsCheckInProgress(CustomDomain $domain): bool
    {
        return $domain->dns_check_started_at !== null
            && ($domain->dns_check_completed_at === null
                || $domain->dns_check_started_at->gt($domain->dns_check_completed_at));
    }

    /**
     * What the redirect surface is actually doing right now.
     *
     * `degraded` means "still serving on grace": the last check saw a problem
     * but the domain has not been withdrawn yet, which is exactly the window a
     * human needs to be told about.
     */
    public static function trafficStatus(CustomDomain $domain): string
    {
        if ($domain->desired_state !== 'enabled') {
            return self::TRAFFIC_OFFLINE;
        }
        if ((bool) $domain->edge_eligible && $domain->tls_status === 'provisioning') {
            return self::TRAFFIC_PROVISIONING;
        }
        if (self::servingReady($domain)) {
            return $domain->dns_error === null
                && $domain->ownership_status === 'verified'
                && $domain->routing_status === 'healthy'
                ? self::TRAFFIC_ONLINE
                : self::TRAFFIC_DEGRADED;
        }

        return $domain->tls_status === 'provisioning' ? self::TRAFFIC_PROVISIONING : self::TRAFFIC_OFFLINE;
    }

    /** Whether links on this hostname are being served right now. */
    public static function servingReady(CustomDomain $domain): bool
    {
        return $domain->desired_state === 'enabled'
            && (bool) $domain->edge_eligible
            && $domain->tls_ready_at !== null;
    }

    /**
     * When a degraded domain will be withdrawn if nothing is fixed, or null
     * when there is no such deadline. The check job ends grace early once the
     * failure budget is spent; this is the time bound shown to humans.
     */
    public static function graceExpiresAt(CustomDomain $domain): ?CarbonInterface
    {
        if (self::trafficStatus($domain) !== self::TRAFFIC_DEGRADED || $domain->dns_first_failed_at === null) {
            return null;
        }
        $graceHours = max(1, min(24, (int) config('uvh.custom_domains.failure_grace_hours', 2)));

        return $domain->dns_first_failed_at->copy()->addHours($graceHours);
    }

    /** The pre-redesign `state` label, derived, for API compatibility only. */
    public static function legacyState(CustomDomain $domain): string
    {
        if ($domain->desired_state !== 'enabled') {
            return 'disabled';
        }
        if ((bool) $domain->edge_eligible && $domain->tls_status === 'provisioning') {
            return 'provisioning';
        }
        if (self::servingReady($domain)) {
            return 'active';
        }
        if ($domain->verified_at === null) {
            if ($domain->ownership_status === 'pending' && self::dnsCheckInProgress($domain)) {
                return 'verifying';
            }

            return $domain->dns_error !== null ? 'error' : 'pending';
        }

        return $domain->dns_error !== null ? 'error' : 'verified';
    }

    /**
     * Open a DNS check. A revalidation keeps every status column (the domain
     * keeps serving while it runs); a first verification starts from `pending`.
     *
     * @return array<string, mixed>
     */
    public static function beginDnsCheck(CustomDomain $domain): array
    {
        return [
            'verification_version' => (int) $domain->verification_version + 1,
            'dns_check_started_at' => now(),
            'dns_error' => null,
            'updated_at' => now(),
        ];
    }

    /**
     * Close a check that will never finish — a cancelled or disabled
     * operation, a lost worker. The version bump is what makes the in-flight
     * worker's result inapplicable, so there is no window where both this and
     * the worker write.
     *
     * @return array<string, mixed>
     */
    public static function cancelDnsCheck(CustomDomain $domain, string $error): array
    {
        return [
            'verification_version' => (int) $domain->verification_version + 1,
            'dns_check_completed_at' => now(),
            'dns_error' => $error,
            'updated_at' => now(),
        ];
    }

    /**
     * Start TLS provisioning for a domain that just proved DNS. The cooldown
     * keeps a broken edge or CA from being hammered by retries; the caller
     * dispatches the job and handles queue failure.
     *
     * @return array<string, mixed>
     */
    public static function beginTlsProvisioning(CustomDomain $domain): array
    {
        $cooldownMinutes = max(1, (int) config('uvh.custom_domains.tls_cooldown_minutes', 5));

        return [
            'tls_version' => (int) $domain->tls_version + 1,
            'tls_status' => 'provisioning',
            'tls_ready_at' => null,
            'tls_error' => null,
            'tls_last_attempt_at' => now(),
            'tls_next_retry_at' => now()->addMinutes($cooldownMinutes),
            'edge_eligible' => true,
            'desired_state' => 'enabled',
            'updated_at' => now(),
        ];
    }

    /**
     * Whether an *automatic* TLS attempt may start. Failure pushes this out
     * further than the manual floor so a permanently broken edge or CA cannot
     * be hammered by the recovery sweep.
     */
    public static function tlsAutoRetryAllowed(CustomDomain $domain): bool
    {
        return $domain->tls_next_retry_at === null || $domain->tls_next_retry_at->lte(now());
    }

    /** Whether a person pressing the button again is allowed yet. */
    public static function tlsManualRetryAllowed(CustomDomain $domain): bool
    {
        if ($domain->tls_last_attempt_at === null) {
            return true;
        }
        $cooldownMinutes = max(1, (int) config('uvh.custom_domains.tls_cooldown_minutes', 5));

        return $domain->tls_last_attempt_at->lte(now()->subMinutes($cooldownMinutes));
    }

    /**
     * The tls_status a certificate earns from its expiry date: `expiring`
     * inside the warn window (still served, but the renewal had better happen)
     * and `ready` otherwise.
     */
    public static function tlsExpiryStatus(?CarbonInterface $notAfter): string
    {
        $warnDays = max(1, (int) config('uvh.custom_domains.tls_expiry_warn_days', 20));
        if ($notAfter === null) {
            return 'ready';
        }

        return $notAfter->lte(now()->addDays($warnDays)) ? 'expiring' : 'ready';
    }

    /**
     * Withdraw the domain: nothing serves, nothing is in flight. The
     * certificate is kept so re-enabling is cheap; an in-flight TLS issuance is
     * marked cancelled rather than left to time out.
     *
     * @return array<string, mixed>
     */
    public static function disableUpdates(CustomDomain $domain): array
    {
        $updates = [
            'desired_state' => 'disabled',
            'edge_eligible' => false,
            'updated_at' => now(),
        ];
        if (self::dnsCheckInProgress($domain)) {
            $updates += self::cancelDnsCheck($domain, 'verification_cancelled');
        }
        if ($domain->tls_status === 'provisioning') {
            $updates['tls_status'] = 'error';
            $updates['tls_error'] = 'provisioning_cancelled';
        }

        return $updates;
    }

    /**
     * The edge lookup predicate: what Caddy's on-demand TLS and the redirect
     * surface accept. Kept in one place so the two cannot disagree.
     *
     * @return Builder<CustomDomain>
     */
    public static function servingQuery()
    {
        return CustomDomain::query()
            ->where('desired_state', 'enabled')
            ->where('edge_eligible', true)
            ->whereNotNull('tls_ready_at');
    }
}
