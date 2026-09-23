<?php

declare(strict_types=1);

namespace App\Support;

use DateTimeInterface;
use Illuminate\Http\JsonResponse;

/**
 * Single owner of the admin step-up freshness window.
 *
 * A step-up carries two proofs: the session's MFA state and the factor typed
 * now. The freshness window bounds how old the first proof may be, closing the
 * "session parked for days, still spends one step-up per day" hole: after the
 * window the session must re-prove its factor through /mfa/reauthenticate
 * (which refreshes `mfa_verified_at`) before any step-up operation runs.
 */
final class MfaFreshness
{
    /** Conservative default; uvh.admin_mfa_fresh_minutes clamps to 1..60. */
    public const DEFAULT_MINUTES = 15;

    public static function windowMinutes(): int
    {
        return max(1, min(60, (int) config('uvh.admin_mfa_fresh_minutes', self::DEFAULT_MINUTES)));
    }

    /** null (never verified) and expired windows are equally not fresh. */
    public static function isFresh(?DateTimeInterface $verifiedAt): bool
    {
        return $verifiedAt !== null && $verifiedAt >= now()->subMinutes(self::windowMinutes());
    }

    /** Uniform 403 for step-up surfaces whose session window lapsed. */
    public static function reauthenticationRequired(): JsonResponse
    {
        return response()->json([
            'error' => 'Vuelve a confirmar tu identidad para continuar',
            'details' => ['reason' => 'mfa_reauthentication_required'],
        ], 403);
    }
}
