<?php

namespace App\Http\Controllers;

use App\Support\Audit;
use App\Support\Auth\AccountQueries;
use App\Support\Auth\AccountReadContext;
use App\Support\Auth\ReauthenticationAdmission;
use App\Support\IsoDate;
use App\Support\MfaAttempts;
use App\Support\MfaFreshness;
use App\Support\UvhRequest;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class MfaSessionController
{
    /** Report only session-local MFA freshness; no factor material is exposed. */
    public function mfaSessionStatus(Request $request): JsonResponse
    {
        $context = AccountReadContext::resolve(UvhRequest::user($request), UvhRequest::sessionId($request));
        if ($context === null) {
            return response()->json(['error' => __('messages.error_bf623cf00a0e86')], 401);
        }

        return response()->json(AccountQueries::mfaSession($context));
    }

    /** Refresh the privileged MFA window without creating or rotating a session. */
    public function mfaReauthenticate(Request $request): JsonResponse
    {
        $password = UvhRequest::inputString($request, 'password');
        $factorCode = trim(UvhRequest::inputString($request, 'factorCode'));
        if ($password === '' || strlen($password) > 72 || strlen($factorCode) > 24) {
            return response()->json(['error' => __('messages.error_1b1aaee656e2a6')], 422);
        }

        $user = UvhRequest::user($request);
        if (MfaAttempts::tooMany($user->id, 'reauthentication')) {
            return MfaAttempts::tooManyResponse($user->id, 'reauthentication');
        }

        $sessionId = UvhRequest::sessionId($request);
        $result = ReauthenticationAdmission::admit($user, $sessionId, $password, $factorCode, UvhRequest::ip($request));

        if ($result['status'] === 'stale') {
            return response()->json(['error' => __('messages.error_3fd9c1eb0bc788')], 409);
        }
        if ($result['status'] === 'not_configured') {
            return response()->json(['error' => __('messages.error_a3308c53a602fa')], 403);
        }
        if ($result['status'] === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, 'reauthentication');
        }
        if ($result['status'] !== 'ok') {
            Audit::write($user->id, 'auth.mfa_reauthentication_failed', 'session', $sessionId, [
                'reason' => $result['status'] === 'password' ? 'password' : 'factor',
            ], UvhRequest::ip($request));

            return response()->json(['error' => __('messages.error_9dfef0f6d97a7d')], 403);
        }

        $verifiedAt = $result['verified_at'];

        return response()->json([
            'ok' => true,
            'verifiedAt' => $this->iso($verifiedAt),
            'expiresAt' => $this->iso(CarbonImmutable::instance($verifiedAt)->addMinutes(MfaFreshness::windowMinutes())),
        ]);
    }

    private function iso(mixed $value): ?string
    {
        return IsoDate::format($value);
    }
}
