<?php

namespace App\Support;

use App\Models\CustomDomain;
use Carbon\CarbonInterface;

/**
 * Single source of truth for automatic DNS revalidation scheduling.
 *
 * Keeping this calculation outside the HTTP layer prevents the diagnostic UI
 * from promising a retry time that differs from the housekeeping worker.
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
        return $domain->dns_check_started_at !== null
            && ($domain->dns_check_completed_at === null
                || $domain->dns_check_started_at->gt($domain->dns_check_completed_at));
    }

    /**
     * Return the first instant at which the scheduler may admit another check.
     * A domain without a completed check has been due since it was created.
     */
    public static function nextAt(CustomDomain $domain): ?CarbonInterface
    {
        if ($domain->state !== 'active' || self::isInProgress($domain)) {
            return null;
        }

        if ($domain->dns_check_completed_at === null) {
            return $domain->created_at;
        }

        return $domain->dns_check_completed_at->copy()->addHours(self::intervalHours($domain));
    }

    public static function isDue(CustomDomain $domain, ?CarbonInterface $at = null): bool
    {
        if ($domain->state !== 'active' || self::isInProgress($domain)) {
            return false;
        }

        $nextAt = self::nextAt($domain);

        return $nextAt !== null && $nextAt->lte($at ?? now());
    }
}
