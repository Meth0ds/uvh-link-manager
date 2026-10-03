<?php

namespace App\Support\Auth;

use App\Models\User;
use App\Support\Audit;
use App\Support\MfaStepUp;
use App\Support\SecurityContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/** Complete transaction for privileged MFA freshness renewal. */
final class ReauthenticationAdmission
{
    /** @return array{status: string, factor?: string, verified_at?: Carbon} */
    public static function admit(User $user, ?string $sessionId, string $password, string $factorCode, ?string $ip): array
    {
        return DB::transaction(function () use ($user, $sessionId, $password, $factorCode, $ip): array {
            $context = SecurityContext::lock($user, $sessionId, true);
            if ($context === null) {
                return ['status' => 'stale'];
            }
            $locked = $context->user;
            $session = $context->session;
            if (! $locked->mfa_enabled) {
                return ['status' => 'not_configured'];
            }

            // Password plus a concrete current factor is sufficient to
            // establish a fresh privileged window, even for a legacy session
            // that predates the mfa_verified_at column.
            // mfaReauthenticate IS the freshness refresh, so it cannot require
            // a fresh window; it charges the account-wide 'reauthentication'
            // budget through MfaStepUp (password + factor failures alike).
            $stepUp = MfaStepUp::verify($locked, $session, $password, $factorCode, false, 'reauthentication');
            if ($stepUp['status'] !== 'ok') {
                return ['status' => $stepUp['status']];
            }
            if (isset($stepUp['recovery_codes'])) {
                $locked->update(['recovery_codes' => $stepUp['recovery_codes'], 'updated_at' => $stepUp['verified_at']]);
            }

            Audit::write($locked->id, 'auth.mfa_reauthenticated', 'session', $sessionId, [
                'factor' => $stepUp['factor'],
            ], $ip);

            return [
                'status' => 'ok',
                'factor' => $stepUp['factor'],
                'verified_at' => $stepUp['verified_at'],
            ];
        });
    }
}
