<?php

namespace App\Support;

use App\Models\CustomDomain;
use Carbon\CarbonInterface;

/**
 * Single source of truth for automatic DNS revalidation scheduling.
 *
 * Keeping this calculation outside the HTTP layer prevents the diagnostic UI
 * from promising a retry time that differs from the housekeeping worker.
 *
 * The scheduler follows intent, not health: any domain the user wants enabled
 * keeps being checked — including one that fell to `failed` — so a repaired DNS
 * configuration is picked up without anyone opening the panel. A disabled
 * domain is off, and nothing is checked until it is wanted again.
 */
final class DomainRevalidationSchedule
{
    public static function intervalHours(CustomDomain $domain): int
    {
        $key = $domain->dns_error === null ? 'revalidation_hours' : 'failure_retry_hours';
        $fallback = $domain->dns_error === null ? 24 : 1;

        return max(1, (int) config('uvh.custom_domains.'.$key, $fallback));
    }

    public static function isInProgress(CustomDomain $domain): bool
    {
        return DomainStatus::dnsCheckInProgress($domain);
    }

    /**
     * Return the first instant at which the scheduler may admit another check.
     * A domain without a completed check has been due since it was created.
     */
    public static function nextAt(CustomDomain $domain): ?CarbonInterface
    {
        if ($domain->desired_state !== 'enabled' || self::isInProgress($domain)) {
            return null;
        }

        if ($domain->dns_check_completed_at === null) {
            return $domain->created_at;
        }

        return $domain->dns_check_completed_at->copy()->addHours(self::intervalHours($domain));
    }

    public static function isDue(CustomDomain $domain, ?CarbonInterface $at = null): bool
    {
        if ($domain->desired_state !== 'enabled' || self::isInProgress($domain)) {
            return false;
        }

        $nextAt = self::nextAt($domain);

        return $nextAt !== null && $nextAt->lte($at ?? now());
    }
}
