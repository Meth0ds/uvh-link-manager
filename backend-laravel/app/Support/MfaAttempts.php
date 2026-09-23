<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Account-wide verification-attempt budget for step-up factor checks.
 *
 * Single owner of "how many failed verifications one account may spend per
 * purpose". Every step-up surface charges the same per-account counter, so
 * draining one session's `uvh-credential` limiter and re-authenticating for a
 * fresh session cannot amplify into more guesses: the budget follows the
 * account, not the session. The MFA login challenge uses the same counter
 * (`mfa-login` purposes), keeping brute force bounded account-wide.
 *
 * Deliberately NOT a per-request middleware: sensitive endpoints keep their
 * own thin wrappers and early pre-checks, but the cache key, limits and
 * failure semantics live here only.
 */
final class MfaAttempts
{
    /** Verification failures allowed per account and purpose… */
    public const LIMIT = 10;

    /** …within this window, in seconds (matches the login-challenge budget). */
    public const WINDOW_SECONDS = 900;

    public static function tooMany(int $userId, string $purpose): bool
    {
        try {
            return RateLimiter::tooManyAttempts(self::key($userId, $purpose), self::LIMIT);
        } catch (\Throwable $error) {
            throw new MfaInfrastructureUnavailable('MFA attempt store unavailable', 0, $error);
        }
    }

    public static function recordFailure(int $userId, string $purpose): void
    {
        try {
            RateLimiter::hit(self::key($userId, $purpose), self::WINDOW_SECONDS);
        } catch (\Throwable $error) {
            throw new MfaInfrastructureUnavailable('MFA attempt store unavailable', 0, $error);
        }
        OperationalMetrics::increment('mfa.failure');
    }

    /**
     * A successful verification restores the full budget (mfa-login contract).
     * Clearing is best-effort: the mutation may already be durable, and a stale
     * failure bucket is safer than turning that success into a misleading 500.
     */
    public static function clear(int $userId, string $purpose): void
    {
        try {
            RateLimiter::clear(self::key($userId, $purpose));
        } catch (\Throwable $error) {
            OperationalMetrics::increment('lock.unavailable');
            report($error);
        }
    }

    /** Uniform 429 for every exhausted step-up surface, with an honest Retry-After. */
    public static function tooManyResponse(int $userId, string $purpose): JsonResponse
    {
        try {
            $retryAfter = max(1, RateLimiter::availableIn(self::key($userId, $purpose)));
        } catch (\Throwable $error) {
            throw new MfaInfrastructureUnavailable('MFA attempt store unavailable', 0, $error);
        }

        return response()->json([
            'error' => 'Demasiados intentos. Espera unos minutos.',
            'retryAfterSeconds' => $retryAfter,
        ], 429)->header('Retry-After', (string) $retryAfter);
    }

    private static function key(int $userId, string $purpose): string
    {
        return 'uvh:mfa:attempts:'.$purpose.':'.$userId;
    }
}
