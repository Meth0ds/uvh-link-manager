<?php

namespace App\Support\Auth;

use App\Models\User;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\UvhRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Grants login authority only from the exact account snapshot whose password was checked. */
final class LoginAdmission
{
    /**
     * The caller must verify the password against this snapshot first.
     * Revalidation, authority and durable audit admission share one transaction.
     *
     * @return array{mfaRequired: true, challenge: string, recoveryAvailable: bool}|array{token: string, user: User}|null
     */
    public static function admit(User $user, Request $request): ?array
    {
        $challenge = null;
        try {
            return DB::transaction(function () use ($user, $request, &$challenge): ?array {
                $locked = User::where('id', $user->id)->lockForUpdate()->first();
                if (! $locked || $locked->deleted_at || ! $locked->email_verified_at
                    || (bool) $locked->mfa_enabled !== (bool) $user->mfa_enabled
                    || (int) $locked->security_version !== (int) $user->security_version
                    || ! hash_equals($locked->password_hash, $user->password_hash)
                    || ! hash_equals(strtolower($locked->email), strtolower($user->email))) {
                    return null;
                }
                if ($locked->mfa_enabled) {
                    Audit::write($locked->id, 'auth.mfa_challenge_issued', 'user', $locked->id, null, UvhRequest::ip($request));
                    $challenge = Ids::randomToken(24);
                    MfaChallengeStore::store($challenge, $locked->id, (int) $locked->security_version);

                    return [
                        'mfaRequired' => true,
                        'challenge' => $challenge,
                        'recoveryAvailable' => is_array($locked->recovery_codes) && count($locked->recovery_codes) > 0,
                    ];
                }
                $token = SessionManager::create($locked->id, $request, (int) $locked->security_version);
                Audit::write($locked->id, 'auth.login', 'user', $locked->id, ['mfa' => false], UvhRequest::ip($request));

                return ['token' => $token, 'user' => $locked];
            });
        } catch (\Throwable $error) {
            if ($challenge !== null) {
                try {
                    MfaChallengeStore::forget($challenge);
                } catch (\Throwable) {
                    // A cache outage may prevent cleanup; the secret was never
                    // published and its original TTL still bounds this orphan.
                }
            }
            throw $error;
        }
    }
}
