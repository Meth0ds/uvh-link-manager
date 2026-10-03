<?php

namespace App\Support\Auth;

use App\Models\User;
use App\Support\AccountRecoveryLifecycle;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\MailAdmissionException;
use App\Support\MfaAttempts;
use App\Support\MfaStepUp;
use App\Support\NotificationInbox;
use App\Support\NotificationKinds;
use App\Support\SecurityContext;
use App\Support\UvhMail;
use Illuminate\Support\Facades\DB;

/** Complete commits for staged factors, enrollment and active MFA changes. */
final class MfaConfigurationAdmission
{
    public static function setup(User $user, ?string $sessionId, string $password, ?string $code, string $encryptedSecret): string
    {
        return DB::transaction(function () use ($user, $sessionId, $password, $code, $encryptedSecret): string {
            $context = SecurityContext::lock($user, $sessionId, true);
            if ($context === null) {
                return 'stale';
            }
            $locked = $context->user;
            $session = $context->session;
            // Replacements obey the shared freshness, account budget and
            // replay checks before staging a new factor. Initial enrollment
            // remains password-only while the account has no active MFA.
            $stepUp = MfaStepUp::verify($locked, $session, $password, $code ?? '', true, 'mfa-setup');
            if ($stepUp['status'] !== 'ok') {
                return $stepUp['status'];
            }
            $updates = [
                'mfa_pending_secret' => $encryptedSecret,
                'mfa_pending_expires_at' => now()->addMinutes(10),
            ];
            if ($stepUp['factor'] === 'recovery') {
                $updates['recovery_codes'] = $stepUp['recovery_codes'];
            }
            $locked->update($updates);

            Audit::write($user->id, 'auth.mfa_setup', 'user', $user->id);

            return 'ok';
        });
    }

    /** @param list<string> $recoveryCodes */
    public static function enable(User $user, ?string $sessionId, string $code, array $recoveryCodes): string
    {
        return DB::transaction(function () use ($user, $sessionId, $code, $recoveryCodes): string {
            $context = SecurityContext::lock($user, $sessionId, true);
            if ($context === null) {
                return 'stale';
            }
            $locked = $context->user;
            $session = $context->session;
            if (MfaAttempts::tooMany($locked->id, 'mfa-enable')) {
                return 'locked';
            }
            if (! $locked->mfa_pending_secret || ! $locked->mfa_pending_expires_at || $locked->mfa_pending_expires_at->lte(now())) {
                MfaAttempts::recordFailure($locked->id, 'mfa-enable');

                return 'invalid';
            }
            $pendingSecret = MfaFactorVerification::decryptSecret($locked->mfa_pending_secret);
            if ($pendingSecret === null || ! MfaFactorVerification::consumeTotp($locked->id, $code, $pendingSecret)) {
                MfaAttempts::recordFailure($locked->id, 'mfa-enable');

                return 'invalid';
            }

            $now = now();
            $reconfigured = (bool) $locked->mfa_enabled;
            $nextVersion = (int) $locked->security_version + 1;
            $locked->update([
                'mfa_secret' => $locked->mfa_pending_secret,
                'mfa_pending_secret' => null,
                'mfa_pending_expires_at' => null,
                'mfa_enabled' => true,
                'recovery_codes' => array_map(fn ($value) => Ids::sha256Hex($value), $recoveryCodes),
                'security_version' => $nextVersion,
                'updated_at' => $now,
            ]);
            $session->update(['security_version' => $nextVersion, 'mfa_verified_at' => $now]);
            DB::table('sessions')->where('user_id', $locked->id)->where('id', '!=', $session->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
            AccountRecoveryLifecycle::cancelActiveForUser((int) $locked->id, $now);
            // Security notices without bearers are still mandatory: commit
            // the factor, recovery hashes and encrypted notice together.
            NotificationInbox::record((int) $locked->id, $reconfigured ? NotificationKinds::MFA_RECONFIGURED : NotificationKinds::MFA_ENABLED);
            if (! UvhMail::mfaEnabled($locked->email, $reconfigured)) {
                throw new MailAdmissionException('MFA enable notice outbox admission failed');
            }

            Audit::write($locked->id, $reconfigured ? 'auth.mfa_reconfigured' : 'auth.mfa_enable', 'user', $locked->id, [
                'recovery_codes_issued' => count($recoveryCodes),
            ]);

            MfaAttempts::clear($locked->id, 'mfa-enable');

            return $reconfigured ? 'reconfigured' : 'enabled';
        });
    }

    public static function cancel(User $user, ?string $sessionId): bool
    {
        return DB::transaction(function () use ($user, $sessionId): bool {
            $locked = SecurityContext::lock($user, $sessionId, true)?->user;
            if (! $locked) {
                return false;
            }

            $locked->update([
                'mfa_pending_secret' => null,
                'mfa_pending_expires_at' => null,
            ]);

            Audit::write($user->id, 'auth.mfa_setup_cancel', 'user', $user->id);

            return true;
        });
    }

    /**
     * @param  list<string>  $recoveryCodes
     * @return array{status: string, factor?: string}
     */
    public static function regenerate(User $user, ?string $sessionId, string $password, string $factorCode, array $recoveryCodes): array
    {
        return DB::transaction(function () use (
            $user,
            $sessionId,
            $password,
            $factorCode,
            $recoveryCodes,
        ): array {
            $context = SecurityContext::lock($user, $sessionId, true);
            if ($context === null || ! $context->user->mfa_enabled) {
                return ['status' => 'stale'];
            }
            $locked = $context->user;
            $session = $context->session;

            // One owner of password + factor + anti-replay + attempt budget
            // + the privileged window. Regeneration replaces the complete
            // set afterwards, so the recovery-code consumption MfaStepUp
            // reports is deliberately discarded (no separate delete first).
            $stepUp = MfaStepUp::verify($locked, $session, $password, $factorCode);
            if ($stepUp['status'] !== 'ok') {
                return ['status' => $stepUp['status']];
            }

            $now = $stepUp['verified_at'];
            $nextVersion = (int) $locked->security_version + 1;
            $locked->update([
                'recovery_codes' => array_map(fn (string $value) => Ids::sha256Hex($value), $recoveryCodes),
                'security_version' => $nextVersion,
                'updated_at' => $now,
            ]);
            $session->update(['security_version' => $nextVersion]);
            DB::table('sessions')->where('user_id', $locked->id)->where('id', '!=', $session->id)
                ->whereNull('revoked_at')->update(['revoked_at' => $now]);
            AccountRecoveryLifecycle::cancelActiveForUser((int) $locked->id, $now);
            NotificationInbox::record((int) $locked->id, NotificationKinds::MFA_RECOVERY_CODES_REGENERATED);
            if (! UvhMail::mfaRecoveryCodesRegenerated($locked->email)) {
                throw new MailAdmissionException('MFA recovery codes notice outbox admission failed');
            }

            Audit::write($user->id, 'auth.mfa_recovery_regenerate', 'user', $user->id, ['revoked_other_sessions' => true]);

            return ['status' => 'ok', 'factor' => $stepUp['factor']];
        });
    }

    public static function disable(User $user, ?string $sessionId, string $password, string $code): string
    {
        return DB::transaction(function () use ($user, $sessionId, $password, $code): string {
            $context = SecurityContext::lock($user, $sessionId, true);
            if ($context === null) {
                return 'stale';
            }
            $locked = $context->user;
            $session = $context->session;
            // Disabling MFA always demands a concrete, current factor; the
            // shared step-up's password-only shortcut never covers it.
            $stepUp = MfaStepUp::verify($locked, $session, $password, $code, true, 'mfa-disable');
            if ($stepUp['status'] !== 'ok') {
                return $stepUp['status'];
            }
            if ($stepUp['factor'] === 'password_only') {
                return 'invalid';
            }
            // Platform administration is MFA-gated. Keeping an administrator
            // flag on an account without MFA creates an unusable operator and
            // can lock the platform out when it is the last administrator.
            if ($locked->is_admin) {
                return 'admin_required';
            }

            $now = $stepUp['verified_at'];
            $nextVersion = (int) $locked->security_version + 1;
            $locked->update([
                'mfa_enabled' => false,
                'mfa_secret' => null,
                'mfa_pending_secret' => null,
                'mfa_pending_expires_at' => null,
                'recovery_codes' => null,
                'security_version' => $nextVersion,
                'updated_at' => $now,
            ]);
            $session->update(['security_version' => $nextVersion, 'mfa_verified_at' => null]);
            DB::table('sessions')->where('user_id', $locked->id)->where('id', '!=', $session->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
            AccountRecoveryLifecycle::cancelActiveForUser((int) $locked->id, $now);
            NotificationInbox::record((int) $locked->id, NotificationKinds::MFA_DISABLED);
            if (! UvhMail::mfaDisabled($locked->email)) {
                throw new MailAdmissionException('MFA disable notice outbox admission failed');
            }

            Audit::write($user->id, 'auth.mfa_disable', 'user', $user->id);

            return 'ok';
        });
    }
}
