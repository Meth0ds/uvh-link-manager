<?php

namespace App\Support\Auth;

use App\Models\EmailToken;
use App\Models\User;
use App\Support\AccountRecoveryLifecycle;
use App\Support\Audit;
use App\Support\MfaStepUp;
use App\Support\PasswordStrength;
use App\Support\SecurityContext;
use Illuminate\Support\Facades\DB;

/** Owns the authenticated password mutation and its security notice/audit commit. */
final class AuthenticatedPasswordChange
{
    /** The caller validates input and computes the password hash before taking locks. */
    public static function admit(
        User $user,
        ?string $sessionId,
        string $current,
        string $newPasswordHash,
        string $newPassword,
        string $factorCode,
    ): string {
        return DB::transaction(function () use ($user, $sessionId, $current, $newPasswordHash, $newPassword, $factorCode): string {
            $context = SecurityContext::lock($user, $sessionId);
            if ($context === null) {
                return 'stale';
            }
            $locked = $context->user;
            $session = $context->session;
            if (! PasswordStrength::isAcceptable($newPassword, $locked->name, $locked->email)) {
                return 'weak';
            }
            // One shared step-up owns the attempt budget, the freshness
            // window and replay protection; the recovery-code consumption
            // it reports joins the new password in the same atomic update.
            $stepUp = MfaStepUp::verify($locked, $session, $current, $factorCode, true, 'password-change');
            if ($stepUp['status'] !== 'ok') {
                return $stepUp['status'];
            }

            $now = now();
            $nextVersion = (int) $locked->security_version + 1;
            $updates = [
                'password_hash' => $newPasswordHash,
                'security_version' => $nextVersion,
                'updated_at' => $now,
            ];
            if (isset($stepUp['recovery_codes'])) {
                $updates['recovery_codes'] = $stepUp['recovery_codes'];
            }
            $locked->update($updates);
            $session->update([
                'security_version' => $nextVersion,
                'mfa_verified_at' => $locked->mfa_enabled ? $now : $session->mfa_verified_at,
            ]);
            DB::table('sessions')->where('user_id', $locked->id)->where('id', '!=', $session->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
            EmailToken::where('user_id', $locked->id)->where('kind', 'reset')->whereNull('used_at')->delete();
            AccountRecoveryLifecycle::cancelActiveForUser((int) $locked->id, $now);
            SecurityIncidentNotice::passwordChanged($locked);
            Audit::write($locked->id, 'auth.password_change', 'user', $locked->id, [
                'factor' => $stepUp['factor'],
                'revoked_other_sessions' => true,
            ]);

            return 'ok:'.$stepUp['factor'];
        });
    }
}
