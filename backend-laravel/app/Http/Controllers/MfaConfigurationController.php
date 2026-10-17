<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\NormalizesRecoveryCodes;
use App\Support\Audit;
use App\Support\Auth\MfaConfigurationAdmission;
use App\Support\Ids;
use App\Support\MailAdmissionException;
use App\Support\MfaAttempts;
use App\Support\MfaFreshness;
use App\Support\MfaInfrastructureUnavailable;
use App\Support\MfaStepUp;
use App\Support\Totp;
use App\Support\UvhCrypto;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class MfaConfigurationController
{
    use NormalizesRecoveryCodes;

    public function mfaSetup(Request $request): JsonResponse
    {
        $password = UvhRequest::inputString($request, 'password');
        $codeInput = $request->input('code');

        if ($password === '' || strlen($password) > 72 || ($codeInput !== null && ! is_string($codeInput))) {
            return response()->json(['error' => __('messages.error_0aa9eb7787117b')], 422);
        }
        $code = is_string($codeInput) ? trim($codeInput) : null;

        $user = UvhRequest::user($request);
        $sessionId = UvhRequest::sessionId($request);
        $secret = Totp::generateSecret();
        $encryptedSecret = UvhCrypto::encryptAtRest($secret);
        $setup = MfaConfigurationAdmission::setup($user, $sessionId, $password, $code, $encryptedSecret);
        if ($setup === 'stale') {
            return response()->json(['error' => __('messages.error_97c5b24eff8715')], 409);
        }
        if ($setup === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, 'mfa-setup');
        }
        if ($setup === 'reauth') {
            return MfaFreshness::reauthenticationRequired();
        }
        if ($setup === 'password') {
            return response()->json(['error' => __('messages.error_30124a1d7f08a4')], 403);
        }
        if ($setup !== 'ok') {
            return response()->json(['error' => __('messages.error_e1c56528479fd9')], 403);
        }
        $uri = Totp::provisioningUri($user->email, 'UVH', $secret);

        return response()->json(['secret' => $secret, 'uri' => $uri]);
    }

    public function mfaEnable(Request $request): JsonResponse
    {
        $code = UvhRequest::inputString($request, 'code');
        if (! preg_match('/^\d{6}$/', $code)) {
            return response()->json(['error' => __('messages.error_f86b8a9bfef328')], 422);
        }

        $user = UvhRequest::user($request);
        $sessionId = UvhRequest::sessionId($request);
        $recoveryCodes = $this->newRecoveryCodes();

        try {
            $enabled = MfaConfigurationAdmission::enable($user, $sessionId, $code, $recoveryCodes);
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['operation' => 'mfa_enable']);

            return response()->json(['error' => __('messages.error_39029df9cbc48a')], 503);
        }
        if ($enabled === 'stale') {
            return response()->json(['error' => __('messages.error_8489bcb73e8c6c')], 409);
        }
        if ($enabled === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, 'mfa-enable');
        }
        if ($enabled === 'invalid') {
            Audit::write($user->id, 'auth.mfa_enable_failed', 'user', $user->id);

            return response()->json(['error' => __('messages.error_0d92aa47f77da5')], 403);
        }

        return response()->json([
            'recoveryCodes' => array_map(fn (string $value) => $this->formatRecoveryCode($value), $recoveryCodes),
        ]);
    }

    /** Discard a staged MFA factor without touching the currently active one. */
    public function mfaCancelSetup(Request $request): JsonResponse
    {
        $user = UvhRequest::user($request);
        $sessionId = UvhRequest::sessionId($request);

        $cancelled = MfaConfigurationAdmission::cancel($user, $sessionId);
        if (! $cancelled) {
            return response()->json(['error' => __('messages.error_44eea620de5939')], 409);
        }

        return response()->json(['ok' => true]);
    }

    /** Replace every recovery credential after a fresh password + factor check. */
    public function mfaRegenerateRecoveryCodes(Request $request): JsonResponse
    {
        $password = UvhRequest::inputString($request, 'password');
        $factorCode = trim(UvhRequest::inputString($request, 'factorCode'));
        $normalizedRecovery = $this->normalizeRecoveryCode($factorCode);
        $isTotp = preg_match('/^\d{6}$/D', $factorCode) === 1;
        $isRecovery = preg_match('/^[A-Z2-9]{16}$/D', $normalizedRecovery) === 1;

        if ($password === '' || strlen($password) > 72 || (! $isTotp && ! $isRecovery)) {
            return response()->json(['error' => __('messages.error_4b111e944de437')], 422);
        }

        $user = UvhRequest::user($request);
        $sessionId = UvhRequest::sessionId($request);
        $recoveryCodes = $this->newRecoveryCodes();

        try {
            $result = MfaConfigurationAdmission::regenerate($user, $sessionId, $password, $factorCode, $recoveryCodes);
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['operation' => 'mfa_recovery_regenerate']);

            return response()->json(['error' => __('messages.error_bebdb13f2aca48')], 503);
        }
        if ($result['status'] === 'stale') {
            return response()->json(['error' => __('messages.error_1e4a9e062e50e0')], 409);
        }
        if ($result['status'] === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, MfaStepUp::ATTEMPT_PURPOSE);
        }
        if ($result['status'] === 'reauth') {
            return MfaFreshness::reauthenticationRequired();
        }
        if ($result['status'] === 'password') {
            Audit::write($user->id, 'auth.mfa_recovery_regenerate_failed', 'user', $user->id, ['reason' => 'password']);

            return response()->json(['error' => __('messages.error_30124a1d7f08a4')], 403);
        }
        if ($result['status'] !== 'ok') {
            Audit::write($user->id, 'auth.mfa_recovery_regenerate_failed', 'user', $user->id, ['reason' => 'factor']);

            return response()->json(['error' => __('messages.error_94f7173a80a9cb')], 403);
        }

        return response()->json([
            'recoveryCodes' => array_map(fn (string $value) => $this->formatRecoveryCode($value), $recoveryCodes),
        ]);
    }

    public function mfaDisable(Request $request): JsonResponse
    {
        $password = UvhRequest::inputString($request, 'password');
        $code = trim(UvhRequest::inputString($request, 'code'));
        $normalizedRecovery = $this->normalizeRecoveryCode($code);
        $isTotp = preg_match('/^\d{6}$/D', $code) === 1;
        $isRecovery = preg_match('/^[A-Z2-9]{16}$/D', $normalizedRecovery) === 1;

        if ($password === '' || strlen($password) > 72 || (! $isTotp && ! $isRecovery)) {
            return response()->json(['error' => __('messages.error_4b111e944de437')], 422);
        }

        $user = UvhRequest::user($request);
        if ($user->mfa_enabled && MfaAttempts::tooMany($user->id, 'mfa-disable')) {
            return MfaAttempts::tooManyResponse($user->id, 'mfa-disable');
        }

        $sessionId = UvhRequest::sessionId($request);
        try {
            $disabled = MfaConfigurationAdmission::disable($user, $sessionId, $password, $code);
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['operation' => 'mfa_disable']);

            return response()->json(['error' => __('messages.error_70bfb4424fae69')], 503);
        } catch (MfaInfrastructureUnavailable $error) {
            report($error);

            return response()->json(['error' => __('messages.error_d91541919924ab')], 503);
        }
        if ($disabled === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, 'mfa-disable');
        }
        if ($disabled === 'reauth') {
            return MfaFreshness::reauthenticationRequired();
        }
        if ($disabled === 'stale') {
            return response()->json(['error' => __('messages.error_3fd9c1eb0bc788')], 409);
        }
        if ($disabled === 'admin_required') {
            return response()->json(['error' => __('messages.error_f6045099d04e3f')], 409);
        }
        if ($disabled !== 'ok') {
            Audit::write($user->id, 'auth.mfa_disable_failed', 'user', $user->id);

            return response()->json(['error' => __('messages.error_9dfef0f6d97a7d')], 403);
        }

        return response()->json(['ok' => true]);
    }

    /** @return array<int, string> */
    private function newRecoveryCodes(): array
    {
        $codes = [];
        for ($i = 0; $i < 10; $i++) {
            $codes[] = Ids::randomRecoveryCode();
        }

        return $codes;
    }

    private function formatRecoveryCode(string $code): string
    {
        return implode('-', str_split($code, 4));
    }
}
