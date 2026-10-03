<?php

namespace App\Support\Auth;

use App\Models\User;
use App\Support\Audit;
use App\Support\SessionManager;
use App\Support\UvhRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Atomic admission for a password-backed MFA login challenge.
 * The caller holds the distributed challenge lock, re-reads its matching
 * owner/version and checks the attempt budget before calling these methods.
 * Account revalidation, factor consumption, session and audit stay together.
 * Cache replay markers deliberately survive a rolled-back SQL transaction.
 */
final class MfaLoginAdmission
{
    /**
     * @return array{status: 'ok', token: string, user: User}|array{status: 'challenge'|'factor'|'unreadable'}
     */
    public static function totp(int $userId, int $securityVersion, string $challenge, string $code, Request $request): array
    {
        return DB::transaction(static function () use ($userId, $securityVersion, $challenge, $code, $request): array {
            $locked = User::where('id', $userId)->whereNull('deleted_at')->lockForUpdate()->first();
            if (! $locked || ! $locked->email_verified_at || ! $locked->mfa_enabled || ! $locked->mfa_secret
                || (int) $locked->security_version !== $securityVersion) {
                return ['status' => 'challenge'];
            }
            $secret = MfaFactorVerification::decryptSecret($locked->mfa_secret);
            if ($secret === null) {
                return ['status' => 'unreadable'];
            }
            if (! MfaFactorVerification::consumeTotp($locked->id, $code, $secret)) {
                return ['status' => 'factor'];
            }
            if (! MfaChallengeStore::consume($challenge)) {
                return ['status' => 'challenge'];
            }
            $token = SessionManager::create($locked->id, $request, (int) $locked->security_version, true);
            Audit::write($locked->id, 'auth.login', 'user', $locked->id, ['mfa' => true], UvhRequest::ip($request));

            return ['status' => 'ok', 'token' => $token, 'user' => $locked];
        });
    }

    /**
     * @return array{status: 'ok', token: string, user: User}|array{status: 'invalid'|'challenge'}
     */
    public static function recovery(int $userId, int $securityVersion, string $challenge, string $code, Request $request): array
    {
        return DB::transaction(static function () use ($userId, $securityVersion, $challenge, $code, $request): array {
            $locked = User::where('id', $userId)->whereNull('deleted_at')->lockForUpdate()->first();
            if (! $locked || ! $locked->email_verified_at || ! $locked->mfa_enabled
                || (int) $locked->security_version !== $securityVersion) {
                // Authority disappeared after the preflight; this is not a
                // wrong recovery factor and must not charge its attempt budget.
                return ['status' => 'challenge'];
            }
            if (! is_array($locked->recovery_codes)) {
                return ['status' => 'invalid'];
            }
            $idx = MfaFactorVerification::recoveryIndex($locked->recovery_codes, $code);
            if ($idx === null) {
                return ['status' => 'invalid'];
            }
            // Consume the cache challenge before committing the database
            // mutation. An unavailable replay store throws and rolls this
            // transaction back, so a recovery credential is never lost
            // without producing an authenticated session.
            if (! MfaChallengeStore::consume($challenge)) {
                return ['status' => 'challenge'];
            }
            $codes = $locked->recovery_codes;
            array_splice($codes, $idx, 1);
            $locked->update(['recovery_codes' => $codes]);
            $token = SessionManager::create($locked->id, $request, (int) $locked->security_version, true);

            $remainingCodes = count($codes);
            Audit::write($locked->id, 'auth.mfa_recovery', 'user', $locked->id);
            if ($remainingCodes <= 2) {
                Audit::write($locked->id, $remainingCodes === 0 ? 'auth.mfa_recovery_exhausted' : 'auth.mfa_recovery_low', 'user', $locked->id, ['remaining' => $remainingCodes]);
            }
            Audit::write($locked->id, 'auth.login', 'user', $locked->id, [
                'mfa' => 'recovery',
                'recovery_codes_remaining' => $remainingCodes,
            ], UvhRequest::ip($request));

            return ['status' => 'ok', 'token' => $token, 'user' => $locked];
        });
    }
}
