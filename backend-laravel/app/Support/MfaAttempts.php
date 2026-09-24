<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Cache\RateLimiter;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;

/**
 * Account-wide verification-attempt budget for step-up factor checks.
 *
 * Single owner of "how many failed verifications one account may spend", at
 * two levels: a per-purpose counter — so one broken surface cannot starve the
 * others — and an account-wide one — so moving between purposes multiplies no
 * guessing budget. Whichever exhausts first refuses the attempt.
 *
 * The two levels do not isolate as cleanly as the second one suggests: two
 * purposes at their own limit add up to the account-wide one, so the third
 * surface gets nothing until both windows clear, and the login challenge
 * (`totp`, `recovery`) charges the same account-wide counter as every step-up
 * purpose — a failure spent on one surface can therefore refuse the
 * legitimate owner's login for the rest of the window. That is the price of
 * "moving between surfaces multiplies no guessing budget", and it is the
 * intended trade: bounded guessing first, surface isolation second.
 *
 * Where the counters live is part of the contract. They must not be resetable
 * by a dependency failure, so they count on the SECURITY store
 * (`UvhLimiters::securityStore()`, falling back to the availability store only
 * where the split is not configured) and never on the failover chain the
 * global `RateLimiter` facade points at: for a credential budget a second
 * backend is a second, empty window, exactly as `UvhLimiters` explains for the
 * named middleware limiters. `SecurityLimiterStoreTest` asserts where this
 * budget lands, because the facade would look identical while counting
 * somewhere a Redis outage could reset.
 *
 * Deliberately NOT a per-request middleware: sensitive endpoints keep their
 * own thin wrappers and early pre-checks, but the cache key, limits and
 * failure semantics live here only.
 */
final class MfaAttempts
{
    /** Verification failures allowed per account and purpose… */
    public const LIMIT = 10;

    /** …and per account across every purpose, within the same window. */
    public const GLOBAL_LIMIT = 20;

    /** …within this window, in seconds (matches the login-challenge budget). */
    public const WINDOW_SECONDS = 900;

    public static function tooMany(int $userId, string $purpose): bool
    {
        try {
            $limiter = self::limiter();

            return $limiter->tooManyAttempts(self::key($userId, $purpose), self::LIMIT)
                || $limiter->tooManyAttempts(self::globalKey($userId), self::GLOBAL_LIMIT);
        } catch (\Throwable $error) {
            throw new MfaInfrastructureUnavailable('MFA attempt store unavailable', 0, $error);
        }
    }

    /** A failure charges both levels: the purpose it was spent on and the account. */
    public static function recordFailure(int $userId, string $purpose): void
    {
        try {
            $limiter = self::limiter();
            $limiter->hit(self::key($userId, $purpose), self::WINDOW_SECONDS);
            $limiter->hit(self::globalKey($userId), self::WINDOW_SECONDS);
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
            $limiter = self::limiter();
            $limiter->clear(self::key($userId, $purpose));
            $limiter->clear(self::globalKey($userId));
        } catch (\Throwable $error) {
            OperationalMetrics::increment('lock.unavailable');
            report($error);
        }
    }

    /** Uniform 429 for every exhausted step-up surface, with an honest Retry-After. */
    public static function tooManyResponse(int $userId, string $purpose): JsonResponse
    {
        try {
            $limiter = self::limiter();
            // Only the levels that are actually spent decide how long the account
            // must wait. Reading the timer of a level that still has allowance
            // over-reports: the window is anchored at the first hit, so a purpose
            // touched *after* the account-wide window started (19 failures
            // elsewhere, then one here) owns a fresher timer and would announce
            // its full fifteen minutes while the account unblocks in far less.
            $waits = [];
            foreach ([[self::key($userId, $purpose), self::LIMIT], [self::globalKey($userId), self::GLOBAL_LIMIT]] as [$key, $limit]) {
                if ($limiter->tooManyAttempts($key, $limit)) {
                    $waits[] = $limiter->availableIn($key);
                }
            }
            $retryAfter = $waits === [] ? 1 : max(1, ...$waits);
        } catch (\Throwable $error) {
            throw new MfaInfrastructureUnavailable('MFA attempt store unavailable', 0, $error);
        }

        return response()->json([
            'error' => 'Demasiados intentos. Espera unos minutos.',
            'retryAfterSeconds' => $retryAfter,
        ], 429)->header('Retry-After', (string) $retryAfter);
    }

    /**
     * The limiter this budget counts on: one built over the security store,
     * per call. The global facade is deliberately NOT it — that singleton is
     * bound to the availability store (or its failover chain) in
     * `AppServiceProvider`, which is right for volume limits and wrong for a
     * credential budget.
     */
    private static function limiter(): RateLimiter
    {
        return new RateLimiter(Cache::store(
            UvhLimiters::securityStore() ?? UvhLimiters::availabilityStore()
        ));
    }

    private static function key(int $userId, string $purpose): string
    {
        return 'uvh:mfa:attempts:'.$purpose.':'.$userId;
    }

    /** The account-wide level: every purpose charges the same counter. */
    private static function globalKey(int $userId): string
    {
        return 'uvh:mfa:attempts:global:'.$userId;
    }
}
