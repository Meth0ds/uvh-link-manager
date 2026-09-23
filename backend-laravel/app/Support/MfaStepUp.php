<?php

namespace App\Support;

use App\Models\User;
use App\Models\UvhSession;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;

/**
 * Shared verification for operations that already hold user/session row locks.
 *
 * A step-up charges the account-wide attempt budget (MfaAttempts) — password
 * and factor failures alike — so a stolen session cannot brute-force its way
 * past the factor by rotating sessions. Beyond the factor typed now, a fresh
 * window (MfaFreshness) bounds how old the session's own MFA proof may be;
 * surfaces that ARE the refresh (mfa/reauthenticate) pass $requireFreshWindow
 * false. The window is answered BEFORE the password, so a parked session
 * cannot use these surfaces to ask "is this the current password?": wrong and
 * right passwords meet the same remediation answer. A successful verification
 * refreshes `mfa_verified_at` and restores the full attempt budget.
 */
class MfaStepUp
{
    /** Surfaces without their own purpose share this account-wide bucket. */
    public const ATTEMPT_PURPOSE = 'stepup';

    /**
     * @return array{status: string, factor?: string, recovery_codes?: array<int, string>, verified_at?: Carbon}
     */
    public static function verify(
        User $user,
        UvhSession $session,
        string $password,
        string $factorCode,
        bool $requireFreshWindow = true,
        string $attemptPurpose = self::ATTEMPT_PURPOSE,
    ): array {
        if (MfaAttempts::tooMany($user->id, $attemptPurpose)) {
            return ['status' => 'locked'];
        }
        // Freshness before any credential check. A parked session must not
        // learn whether a password is current from these surfaces: it gets the
        // same `reauth` answer whatever it types, and nothing it sends is
        // charged to the account budget (the only charged failures are the
        // ones that reach a credential check on a session allowed to spend it).
        if ($user->mfa_enabled && $requireFreshWindow && ! MfaFreshness::isFresh($session->mfa_verified_at)) {
            // null = never verified (legacy 'stale'); past = the window lapsed.
            return ['status' => $session->mfa_verified_at === null ? 'stale' : 'reauth'];
        }
        if (! Hash::check($password, $user->password_hash)) {
            MfaAttempts::recordFailure($user->id, $attemptPurpose);

            return ['status' => 'password'];
        }
        if (! $user->mfa_enabled) {
            MfaAttempts::clear($user->id, $attemptPurpose);

            return ['status' => 'ok', 'factor' => 'password_only'];
        }

        $factorCode = trim($factorCode);
        if (preg_match('/^\d{6}$/D', $factorCode)) {
            if (! is_string($user->mfa_secret) || $user->mfa_secret === '') {
                return self::factorFailure($user->id, $attemptPurpose);
            }
            try {
                $secret = UvhCrypto::decryptAtRest($user->mfa_secret);
            } catch (\Throwable) {
                return self::factorFailure($user->id, $attemptPurpose);
            }
            $counter = Totp::matchingCounter($factorCode, $secret);
            if ($counter === null) {
                return self::factorFailure($user->id, $attemptPurpose);
            }
            $factor = substr(hash('sha256', $secret), 0, 24);
            try {
                $reserved = Cache::add('uvh:mfa:totp-used:'.$user->id.':'.$factor.':'.$counter, true, now()->addMinutes(3));
            } catch (\Throwable $error) {
                throw new MfaInfrastructureUnavailable('MFA replay store unavailable', 0, $error);
            }
            if (! $reserved) {
                return self::factorFailure($user->id, $attemptPurpose);
            }

            return self::success($user, $session, $attemptPurpose, 'totp');
        }

        $normalized = strtoupper((string) preg_replace('/[\s-]+/', '', $factorCode));
        if (! preg_match('/^[A-Z2-9]{16}$/D', $normalized) || ! is_array($user->recovery_codes)) {
            return self::factorFailure($user->id, $attemptPurpose);
        }
        $target = Ids::sha256Hex($normalized);
        $match = null;
        foreach ($user->recovery_codes as $index => $hash) {
            if (is_string($hash) && strlen($hash) === 64 && hash_equals($hash, $target)) {
                $match = (int) $index;
            }
        }
        if ($match === null) {
            return self::factorFailure($user->id, $attemptPurpose);
        }
        $remaining = $user->recovery_codes;
        array_splice($remaining, $match, 1);

        // Consumption is NOT persisted here: callers own the recovery_codes
        // write (or replace the whole set, as mfaRegenerateRecoveryCodes does).
        return self::success($user, $session, $attemptPurpose, 'recovery', $remaining);
    }

    /** @return array{status: string} */
    private static function factorFailure(int $userId, string $attemptPurpose): array
    {
        MfaAttempts::recordFailure($userId, $attemptPurpose);

        return ['status' => 'factor'];
    }

    /**
     * @param  array<int, string>|null  $remaining
     * @return array{status: string, factor: string, recovery_codes?: array<int, string>, verified_at: Carbon}
     */
    private static function success(User $user, UvhSession $session, string $attemptPurpose, string $factor, ?array $remaining = null): array
    {
        MfaAttempts::clear($user->id, $attemptPurpose);
        $verifiedAt = now();
        $session->update(['mfa_verified_at' => $verifiedAt]);

        $result = ['status' => 'ok', 'factor' => $factor, 'verified_at' => $verifiedAt];
        if ($remaining !== null) {
            $result['recovery_codes'] = $remaining;
        }

        return $result;
    }
}
