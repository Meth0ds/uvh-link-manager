<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\NormalizesRecoveryCodes;
use App\Models\User;
use App\Support\Audit;
use App\Support\Auth\MfaChallengeStore;
use App\Support\Auth\MfaLoginAdmission;
use App\Support\MfaAttempts;
use App\Support\SessionManager;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

final class MfaChallengeController
{
    use NormalizesRecoveryCodes;

    public function mfaVerify(Request $request): JsonResponse
    {
        $challenge = UvhRequest::inputString($request, 'challenge');
        $code = UvhRequest::inputString($request, 'code');

        if ($challenge === '' || strlen($challenge) > 128 || ! preg_match('/^\d{6}$/', $code)) {
            return response()->json(['error' => __('messages.error_f86b8a9bfef328')], 422);
        }

        $ch = MfaChallengeStore::get($challenge);
        if (! $ch) {
            return response()->json(['error' => __('messages.error_0cba14a15d63a0')], 401);
        }

        $user = User::where('id', $ch['user_id'])->whereNull('deleted_at')->first();
        if (! $user || ! $user->email_verified_at || ! $user->mfa_secret) {
            return response()->json(['error' => __('messages.error_f4453c6b66e8a9')], 401);
        }
        if ((int) $ch['security_version'] !== (int) $user->security_version) {
            MfaChallengeStore::forget($challenge);

            return response()->json(['error' => __('messages.error_0cba14a15d63a0')], 401);
        }

        if (MfaAttempts::tooMany($user->id, 'totp')) {
            return MfaAttempts::tooManyResponse($user->id, 'totp');
        }

        try {
            $lock = Cache::lock(MfaChallengeStore::lockKey($challenge), 15);
            if (! $lock->get()) {
                return response()->json(['error' => __('messages.error_2b46052d206c12')], 409);
            }
        } catch (\Throwable) {
            Audit::write($user->id, 'auth.mfa_lock_unavailable', 'user', $user->id, ['method' => 'totp']);

            return response()->json(['error' => __('messages.error_7518973c358fbe')], 503);
        }

        try {
            // Re-read both challenge and identity after taking the distributed
            // lock. TOTP and recovery then cannot race to consume one login.
            $ch = MfaChallengeStore::get($challenge);
            $user = $ch ? User::where('id', $ch['user_id'])->whereNull('deleted_at')->first() : null;
            if (! $ch || ! $user || ! $user->email_verified_at || ! $user->mfa_secret
                || (int) $ch['security_version'] !== (int) $user->security_version) {
                MfaChallengeStore::forget($challenge);

                return response()->json(['error' => __('messages.error_0cba14a15d63a0')], 401);
            }

            $verified = MfaLoginAdmission::totp((int) $user->id, (int) $ch['security_version'], $challenge, $code, $request);
            if ($verified['status'] === 'unreadable') {
                return response()->json(['error' => __('messages.error_06fa2d6b1d3d0f')], 409);
            }
            if ($verified['status'] === 'factor') {
                MfaAttempts::recordFailure($user->id, 'totp');
                Audit::write($user->id, 'auth.mfa_failed', 'user', $user->id, ['method' => 'totp'], UvhRequest::ip($request));

                return response()->json(['error' => __('messages.error_4454e8b15406c0')], 401);
            }
            if ($verified['status'] !== 'ok') {
                return response()->json(['error' => __('messages.error_0cba14a15d63a0')], 401);
            }
            MfaAttempts::clear($user->id, 'totp');

            return response()->json(['user' => UvhRequest::publicUser($verified['user'])])
                ->withCookie(SessionManager::cookie($verified['token']));

        } finally {
            try {
                $lock->release();
            } catch (\Throwable) {
                // The short TTL is the final safeguard if the cache backend
                // disappears after acquisition.
            }
        }
    }

    public function mfaRecovery(Request $request): JsonResponse
    {
        $challenge = UvhRequest::inputString($request, 'challenge');
        $code = $this->normalizeRecoveryCode(UvhRequest::inputString($request, 'code'));

        if ($challenge === '' || strlen($challenge) > 128 || ! preg_match('/^[A-Z2-9]{16}$/D', $code)) {
            return response()->json(['error' => __('messages.error_4be7cadeac20a6')], 422);
        }

        $ch = MfaChallengeStore::get($challenge);
        if (! $ch) {
            return response()->json(['error' => __('messages.error_0cba14a15d63a0')], 401);
        }

        $user = User::where('id', $ch['user_id'])->whereNull('deleted_at')->first();

        if (! $user || ! $user->email_verified_at || ! $user->mfa_enabled || $user->recovery_codes === null) {
            return response()->json(['error' => __('messages.error_a02a98ab8ad529')], 401);
        }
        if ((int) $ch['security_version'] !== (int) $user->security_version) {
            MfaChallengeStore::forget($challenge);

            return response()->json(['error' => __('messages.error_0cba14a15d63a0')], 401);
        }

        if (MfaAttempts::tooMany($user->id, 'recovery')) {
            return MfaAttempts::tooManyResponse($user->id, 'recovery');
        }

        try {
            $lock = Cache::lock(MfaChallengeStore::lockKey($challenge), 15);
            if (! $lock->get()) {
                return response()->json(['error' => __('messages.error_2b46052d206c12')], 409);
            }
        } catch (\Throwable) {
            Audit::write($user->id, 'auth.mfa_lock_unavailable', 'user', $user->id, ['method' => 'recovery']);

            return response()->json(['error' => __('messages.error_7518973c358fbe')], 503);
        }

        try {
            $ch = MfaChallengeStore::get($challenge);
            if (! $ch || (int) $ch['user_id'] !== (int) $user->id) {
                return response()->json(['error' => __('messages.error_0cba14a15d63a0')], 401);
            }

            // Consume the one-time recovery code while locking the user row.
            // The distributed challenge lock also prevents a parallel TOTP
            // request from spending this login at the same time.
            $consumed = MfaLoginAdmission::recovery((int) $user->id, (int) $ch['security_version'], $challenge, $code, $request);
            if ($consumed['status'] === 'challenge') {
                return response()->json(['error' => __('messages.error_0cba14a15d63a0')], 401);
            }
            if ($consumed['status'] !== 'ok') {
                MfaAttempts::recordFailure($user->id, 'recovery');
                Audit::write($user->id, 'auth.mfa_failed', 'user', $user->id, ['method' => 'recovery'], UvhRequest::ip($request));

                return response()->json(['error' => __('messages.error_a02a98ab8ad529')], 401);
            }

            MfaAttempts::clear($user->id, 'recovery');

            return response()->json(['user' => UvhRequest::publicUser($consumed['user'])])
                ->withCookie(SessionManager::cookie($consumed['token']));

        } finally {
            try {
                $lock->release();
            } catch (\Throwable) {
                // See the TOTP path: the lock remains bounded by its TTL.
            }
        }
    }
}
