<?php

namespace App\Support;

/** Shared effective limits, not a pricing plan or a promise of availability. */
final class WorkspaceLimits
{
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
}
