<?php

namespace App\Support;

/**
 * Which named limiter belongs to which class of risk.
 *
 * The two classes do not trade the same thing, so they must not share a store:
 *
 *  - **Availability** limiters (`uvh-resolve`, `uvh-report`, `uvh-status`,
 *    `uvh-api`, `uvh-link-create`, `uvh-pending`, …) bound volume. Their whole point is to
 *    keep the public surface served, so they tolerate a degraded backend: the
 *    attempt is counted on the second member of the chain and the visitor gets
 *    their redirect.
 *  - **Security** limiters bound *credential guessing*. For them a second
 *    backend is not a fallback but a second window: the counter starts at zero,
 *    the attacker gets a fresh budget for as long as the outage lasts, and when
 *    the first backend returns its older counters can block a legitimate
 *    account that had already forgotten the attempt. A window that can be reset
 *    by a dependency failure is not a protection.
 *
 * The criterion for the list below is the subject being protected — a
 * credential, an account or a recovery secret — not the endpoint's importance.
 * Limits that merely bound traffic stay on the availability store even when
 * they guard sensitive-looking data, because taking them off the failover chain
 * would remove the availability they exist to provide.
 */
final class UvhLimiters
{
    /**
     * Named limiters that count on the security store.
     *
     * Every name here is registered in `AppServiceProvider` and referenced from
     * `routes/api.php`; `UvhLimitersTest` holds both ends together.
     *
     * @var list<string>
     */
    public const SECURITY = [
        'uvh-login',
        'uvh-mfa',
        'uvh-email-verify',
        'uvh-password-reset',
        'uvh-account-recovery',
        'uvh-security-incident',
        'uvh-credential',
        'uvh-register',
    ];

    /**
     * Whether a `throttle:` declaration bounds a credential.
     *
     * Laravel accepts a comma-separated list in one argument — `throttle:a,b`
     * applies both — so the comparison cannot be a lookup of the raw string:
     * `uvh-api,uvh-login` would answer "not security" and the login budget would
     * silently go back to counting on the failover chain, which is the exact
     * discontinuity this split removes. A declaration counts as security when
     * *any* of its members is one: the security store is a single shared backend
     * and never a fallback chain, so counting a mixed declaration there is the
     * conservative direction.
     */
    public static function isSecurity(string $name): bool
    {
        foreach (explode(',', $name) as $candidate) {
            if (in_array(trim($candidate), self::SECURITY, true)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Store the security limiters must count on.
     *
     * Returns null when no dedicated store is configured, which means the
     * limiter keeps using the availability store. That is the pre-split
     * behaviour, and it is what non-production environments get; production
     * refuses to boot without an explicit value, because a missing one
     * silently preserves the discontinuity this separation removes.
     */
    public static function securityStore(): ?string
    {
        $store = config('cache.limiter_security');

        return is_string($store) && trim($store) !== '' ? trim($store) : null;
    }
}
