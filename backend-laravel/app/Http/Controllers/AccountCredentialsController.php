<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\NormalizesRecoveryCodes;
use App\Http\Controllers\Concerns\ValidatesAuthInput;
use App\Models\EmailChangeRequest;
use App\Support\Audit;
use App\Support\Auth\AuthenticatedPasswordChange;
use App\Support\Auth\CredentialChangeResponse;
use App\Support\Auth\EmailChangeAdmission;
use App\Support\Auth\EmailChangeReservationConflict;
use App\Support\FrontendUrl;
use App\Support\Ids;
use App\Support\MailAdmissionException;
use App\Support\MfaAttempts;
use App\Support\MfaFreshness;
use App\Support\MfaInfrastructureUnavailable;
use App\Support\PasswordStrength;
use App\Support\UvhRequest;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

final class AccountCredentialsController
{
    use NormalizesRecoveryCodes;
    use ValidatesAuthInput;

    public function requestEmailChange(Request $request): JsonResponse
    {
        $newEmail = strtolower(trim(UvhRequest::inputString($request, 'newEmail')));
        $password = UvhRequest::inputString($request, 'password');
        $factorInput = $request->input('factorCode');
        if (! $this->validEmail($newEmail) || $password === '' || strlen($password) > 72
            || ($factorInput !== null && ! is_string($factorInput))) {
            return response()->json(['error' => __('messages.error_0aa9eb7787117b')], 422);
        }

        $user = UvhRequest::user($request);
        if (strtolower($user->email) === $newEmail) {
            return response()->json(['error' => __('messages.error_3455db4793c274')], 422);
        }

        $factorCode = is_string($factorInput) ? trim($factorInput) : '';
        $normalizedRecovery = $this->normalizeRecoveryCode($factorCode);
        $isTotp = preg_match('/^\d{6}$/D', $factorCode) === 1;
        $isRecovery = preg_match('/^[A-Z2-9]{16}$/D', $normalizedRecovery) === 1;
        if ($user->mfa_enabled && (! $isTotp && ! $isRecovery)) {
            return response()->json(['error' => __('messages.error_a5d2b00905f9f3')], 422);
        }
        if ($user->mfa_enabled && MfaAttempts::tooMany($user->id, 'email-change')) {
            return MfaAttempts::tooManyResponse($user->id, 'email-change');
        }

        $token = Ids::randomToken(32);
        $tokenHash = Ids::sha256Hex($token);
        $verificationUrl = $this->appUrl().'/auth/confirm-email#token='.rawurlencode($token);
        $sessionId = UvhRequest::sessionId($request);
        try {
            $result = EmailChangeAdmission::request($user, $sessionId, $newEmail, $password, $factorCode, $tokenHash, $verificationUrl);
        } catch (EmailChangeReservationConflict) {
            return response()->json(['error' => __('messages.error_96d4d64ff80c35')], 409);
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['operation' => 'request_email_change']);

            return response()->json(['error' => __('messages.error_72efb8a9bf07cb')], 503);
        } catch (MfaInfrastructureUnavailable $error) {
            report($error);

            return response()->json(['error' => __('messages.error_4b9775bc6b5c9f')], 503);
        } catch (QueryException $e) {
            if (($e->errorInfo[0] ?? null) === '23505') {
                return response()->json(['error' => __('messages.error_96d4d64ff80c35')], 409);
            }
            throw $e;
        }

        if ($result['status'] === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, 'email-change');
        }
        if ($result['status'] === 'reauth') {
            return MfaFreshness::reauthenticationRequired();
        }
        if ($result['status'] === 'stale') {
            return response()->json(['error' => __('messages.error_cebfd9e5384bc0')], 409);
        }
        if ($result['status'] === 'password') {
            Audit::write($user->id, 'auth.email_change_failed', 'user', $user->id, ['reason' => 'password']);

            return response()->json(['error' => __('messages.error_30124a1d7f08a4')], 403);
        }
        if ($result['status'] === 'factor') {
            Audit::write($user->id, 'auth.email_change_failed', 'user', $user->id, ['reason' => 'factor']);

            return response()->json(['error' => __('messages.error_94f7173a80a9cb')], 403);
        }
        if ($result['status'] === 'same') {
            return response()->json(['error' => __('messages.error_3455db4793c274')], 422);
        }
        if ($result['status'] === 'conflict') {
            return response()->json(['error' => __('messages.error_05ff1c327076ca')], 409);
        }

        return response()->json(['user' => UvhRequest::publicUser($user->refresh())]);
    }

    public function cancelEmailChange(Request $request): JsonResponse
    {
        $password = UvhRequest::inputString($request, 'password');
        $factorCode = trim(UvhRequest::inputString($request, 'factorCode'));
        $normalizedRecovery = $this->normalizeRecoveryCode($factorCode);
        $isTotp = preg_match('/^\d{6}$/D', $factorCode) === 1;
        $isRecovery = preg_match('/^[A-Z2-9]{16}$/D', $normalizedRecovery) === 1;
        if ($password === '' || strlen($password) > 72) {
            return response()->json(['error' => __('messages.error_a45c7944a2f685')], 422);
        }

        $user = UvhRequest::user($request);
        if ($user->mfa_enabled && (! $isTotp && ! $isRecovery)) {
            return response()->json(['error' => __('messages.error_a5d2b00905f9f3')], 422);
        }
        if ($user->mfa_enabled && MfaAttempts::tooMany($user->id, 'email-change')) {
            return MfaAttempts::tooManyResponse($user->id, 'email-change');
        }

        $sessionId = UvhRequest::sessionId($request);
        try {
            $result = EmailChangeAdmission::cancel($user, $sessionId, $password, $factorCode);
        } catch (MfaInfrastructureUnavailable $error) {
            report($error);

            return response()->json(['error' => __('messages.error_81ec5db18e977c')], 503);
        }

        if ($result === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, 'email-change');
        }
        if ($result === 'reauth') {
            return MfaFreshness::reauthenticationRequired();
        }
        if ($result === 'stale') {
            return response()->json(['error' => __('messages.error_3fd9c1eb0bc788')], 409);
        }
        if ($result === 'password') {
            return response()->json(['error' => __('messages.error_30124a1d7f08a4')], 403);
        }
        if ($result === 'factor') {
            return response()->json(['error' => __('messages.error_94f7173a80a9cb')], 403);
        }

        return response()->json(['user' => UvhRequest::publicUser($user->refresh())]);
    }

    public function confirmEmailChange(Request $request): JsonResponse
    {
        $token = UvhRequest::inputString($request, 'token');
        if (! preg_match('/^[A-Za-z0-9_-]{43}$/D', $token)) {
            return response()->json(['error' => __('messages.error_f0bd101ade1cc6')], 422);
        }

        $tokenHash = Ids::sha256Hex($token);
        $snapshot = EmailChangeRequest::where('id', $tokenHash)->first(['id', 'user_id']);
        try {
            $result = $snapshot ? EmailChangeAdmission::confirm($snapshot, $tokenHash) : ['status' => 'invalid'];
        } catch (MailAdmissionException) {
            Audit::write((int) $snapshot->user_id, 'auth.email_delivery_failed', 'user', $snapshot->user_id, ['operation' => 'confirm_email_change']);

            return response()->json(['error' => __('messages.error_db3552cfb73084')], 503);
        } catch (QueryException $e) {
            if (($e->errorInfo[0] ?? null) === '23505') {
                return response()->json(['error' => __('messages.error_05ff1c327076ca')], 409);
            }
            throw $e;
        }

        if ($result['status'] === 'expired') {
            return response()->json(['error' => __('messages.error_cd9862e051d1f1')], 400);
        }
        if ($result['status'] === 'conflict') {
            return response()->json(['error' => __('messages.error_8d87d2a9d8d951')], 409);
        }
        if ($result['status'] !== 'ok') {
            return response()->json(['error' => __('messages.error_b2b9e4edb53545')], 400);
        }

        return CredentialChangeResponse::forUser($request, $result['user_id']);
    }

    public function changePassword(Request $request): JsonResponse
    {
        $current = UvhRequest::inputString($request, 'current');
        $newPassword = UvhRequest::inputString($request, 'newPassword');
        $factorInput = $request->input('factorCode');

        if ($current === '' || strlen($current) > 72 || ! $this->validPassword($newPassword)
            || ($factorInput !== null && ! is_string($factorInput))) {
            return response()->json(['error' => __('messages.error_0aa9eb7787117b')], 422);
        }
        if (hash_equals($current, $newPassword)) {
            return response()->json(['error' => __('messages.error_706ed34dcef6b4')], 422);
        }

        $user = UvhRequest::user($request);
        if (! PasswordStrength::isAcceptable($newPassword, $user->name, $user->email)) {
            return response()->json(['error' => __('messages.error_637cd115d3504c')], 422);
        }

        $factorCode = is_string($factorInput) ? trim($factorInput) : '';
        $normalizedRecovery = $this->normalizeRecoveryCode($factorCode);
        $isTotp = preg_match('/^\d{6}$/D', $factorCode) === 1;
        $isRecovery = preg_match('/^[A-Z2-9]{16}$/D', $normalizedRecovery) === 1;
        if ($user->mfa_enabled && (! $isTotp && ! $isRecovery)) {
            return response()->json(['error' => __('messages.error_a5d2b00905f9f3')], 422);
        }
        if ($user->mfa_enabled && MfaAttempts::tooMany($user->id, 'password-change')) {
            return MfaAttempts::tooManyResponse($user->id, 'password-change');
        }

        $sessionId = UvhRequest::sessionId($request);
        // Bcrypt is deliberately computed before taking the user/session row
        // locks. A slow password hash must not unnecessarily serialize other
        // security operations for this account.
        $newPasswordHash = Hash::make($newPassword);
        try {
            $changed = AuthenticatedPasswordChange::admit($user, $sessionId, $current, $newPasswordHash, $newPassword, $factorCode);
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['kind' => 'password_changed']);

            // A DB rollback restores persisted recovery codes, but not a TOTP
            // counter consumed in shared cache. Never delete that replay mark;
            // the user can retry with the authenticator's next code.
            return response()->json(['error' => __('messages.error_bf3f674f116859')], 503);
        } catch (MfaInfrastructureUnavailable $error) {
            report($error);

            return response()->json(['error' => __('messages.error_7386a663994a6b')], 503);
        }
        if ($changed === 'weak') {
            return response()->json(['error' => __('messages.error_637cd115d3504c')], 422);
        }
        if ($changed === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, 'password-change');
        }
        if ($changed === 'reauth') {
            return MfaFreshness::reauthenticationRequired();
        }
        if ($changed === 'stale') {
            return response()->json(['error' => __('messages.error_9a57244357b64f')], 409);
        }
        if ($changed === 'password') {
            Audit::write($user->id, 'auth.password_change_failed', 'user', $user->id, ['reason' => 'password']);

            return response()->json(['error' => __('messages.error_a9c8202ab1e8f5')], 403);
        }
        if ($changed === 'factor') {
            Audit::write($user->id, 'auth.password_change_failed', 'user', $user->id, ['reason' => 'factor']);

            return response()->json(['error' => __('messages.error_94f7173a80a9cb')], 403);
        }

        return response()->json(['ok' => true]);
    }

    private function appUrl(): string
    {
        return FrontendUrl::base();
    }
}
