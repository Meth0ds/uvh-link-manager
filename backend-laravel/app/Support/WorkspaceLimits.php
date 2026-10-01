<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;

/** Shared effective limits, not a pricing plan or a promise of availability. */
final class WorkspaceLimits
{
    public const COLLECTIONS = 500;

    public const TAGS = 500;

    public const LINK_TEMPLATES = 200;

    public const DOMAINS = 20;

    public const ACTIVE_TOKENS = 20;

    public const WEBHOOKS = 20;

    public const ACTIVE_INVITATIONS = 100;

    public const ANALYTICS_RANGE_DAYS = 180;

    public static function analyticsRetentionDays(): int
    {
        // Match housekeeping's existing effective fallback/clamp. This describes
        // its cutoff policy, not proof that scheduled deletion has actually run.
        return max(1, (int) config('uvh.housekeeping.analytics_retention_days', 180));
    }

    /** A recent successful purge under the current policy, never configuration alone. */
    public static function analyticsPurgeVerified(): bool
    {
        try {
            $proof = Cache::get('uvh:retention:analytics');
            $age = is_array($proof) && is_int($proof['completed_at'] ?? null)
                ? time() - $proof['completed_at'] : -1;

            return is_array($proof) && $age >= 0
                && $age <= max(600, (int) config('uvh.housekeeping.interval_minutes', 60) * 120)
                && ($proof['retention_days'] ?? null) === self::analyticsRetentionDays();
        } catch (\Throwable) {
            return false;
        }
    }

    public static function limit(string $resource): int
    {
        $ceilings = ['members' => 10000, 'domains' => self::DOMAINS, 'tokens' => self::ACTIVE_TOKENS,
            'webhooks' => self::WEBHOOKS, 'invitations' => self::ACTIVE_INVITATIONS,
            'collections' => self::COLLECTIONS, 'tags' => self::TAGS, 'templates' => self::LINK_TEMPLATES];
        $value = config('entitlements.limits.'.$resource);
        if (! isset($ceilings[$resource]) || ! is_int($value) || $value < 1 || $value > $ceilings[$resource]) {
            throw new \LogicException('Invalid workspace entitlement limit');
        }

        return $value;
    }
}
