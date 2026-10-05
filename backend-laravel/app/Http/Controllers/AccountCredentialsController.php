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
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $user = UvhRequest::user($request);
        if (strtolower($user->email) === $newEmail) {
            return response()->json(['error' => 'El nuevo email debe ser distinto del actual'], 422);
        }

        $factorCode = is_string($factorInput) ? trim($factorInput) : '';
        $normalizedRecovery = $this->normalizeRecoveryCode($factorCode);
        $isTotp = preg_match('/^\d{6}$/D', $factorCode) === 1;
        $isRecovery = preg_match('/^[A-Z2-9]{16}$/D', $normalizedRecovery) === 1;
        if ($user->mfa_enabled && (! $isTotp && ! $isRecovery)) {
            return response()->json(['error' => 'Introduce un código de autenticación o recuperación válido'], 422);
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
            return response()->json(['error' => 'Ese email ya está en uso o pendiente de confirmación'], 409);
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['operation' => 'request_email_change']);

            return response()->json(['error' => 'No se pudieron guardar los avisos. No se aplicó la nueva solicitud de email. Inténtalo de nuevo más tarde'], 503);
        } catch (MfaInfrastructureUnavailable $error) {
            report($error);

            return response()->json(['error' => 'La verificación MFA no está disponible. No se solicitó el cambio de email. Inténtalo de nuevo más tarde'], 503);
        } catch (QueryException $e) {
            if (($e->errorInfo[0] ?? null) === '23505') {
                return response()->json(['error' => 'Ese email ya está en uso o pendiente de confirmación'], 409);
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
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión antes de cambiar el email'], 409);
        }
        if ($result['status'] === 'password') {
            Audit::write($user->id, 'auth.email_change_failed', 'user', $user->id, ['reason' => 'password']);

            return response()->json(['error' => 'Contraseña incorrecta'], 403);
        }
        if ($result['status'] === 'factor') {
            Audit::write($user->id, 'auth.email_change_failed', 'user', $user->id, ['reason' => 'factor']);

            return response()->json(['error' => 'El código de autenticación o recuperación es incorrecto'], 403);
        }
        if ($result['status'] === 'same') {
            return response()->json(['error' => 'El nuevo email debe ser distinto del actual'], 422);
        }
        if ($result['status'] === 'conflict') {
            return response()->json(['error' => 'Ese email ya está registrado'], 409);
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
            return response()->json(['error' => 'Contraseña requerida'], 422);
        }

        $user = UvhRequest::user($request);
        if ($user->mfa_enabled && (! $isTotp && ! $isRecovery)) {
            return response()->json(['error' => 'Introduce un código de autenticación o recuperación válido'], 422);
        }
        if ($user->mfa_enabled && MfaAttempts::tooMany($user->id, 'email-change')) {
            return MfaAttempts::tooManyResponse($user->id, 'email-change');
        }

        $sessionId = UvhRequest::sessionId($request);
        try {
            $result = EmailChangeAdmission::cancel($user, $sessionId, $password, $factorCode);
        } catch (MfaInfrastructureUnavailable $error) {
            report($error);

            return response()->json(['error' => 'La verificación MFA no está disponible. No se canceló la solicitud. Inténtalo de nuevo más tarde'], 503);
        }

        if ($result === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, 'email-change');
        }
        if ($result === 'reauth') {
            return MfaFreshness::reauthenticationRequired();
        }
        if ($result === 'stale') {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión'], 409);
        }
        if ($result === 'password') {
            return response()->json(['error' => 'Contraseña incorrecta'], 403);
        }
        if ($result === 'factor') {
            return response()->json(['error' => 'El código de autenticación o recuperación es incorrecto'], 403);
        }

        return response()->json(['user' => UvhRequest::publicUser($user->refresh())]);
    }

    public function confirmEmailChange(Request $request): JsonResponse
    {
        $token = UvhRequest::inputString($request, 'token');
        if (! preg_match('/^[A-Za-z0-9_-]{43}$/D', $token)) {
            return response()->json(['error' => 'Token inválido'], 422);
        }

        $tokenHash = Ids::sha256Hex($token);
        $snapshot = EmailChangeRequest::where('id', $tokenHash)->first(['id', 'user_id']);
        try {
            $result = $snapshot ? EmailChangeAdmission::confirm($snapshot, $tokenHash) : ['status' => 'invalid'];
        } catch (MailAdmissionException) {
            Audit::write((int) $snapshot->user_id, 'auth.email_delivery_failed', 'user', $snapshot->user_id, ['operation' => 'confirm_email_change']);

            return response()->json(['error' => 'No se pudieron guardar los avisos. No se cambió el email. Inténtalo de nuevo más tarde'], 503);
        } catch (QueryException $e) {
            if (($e->errorInfo[0] ?? null) === '23505') {
                return response()->json(['error' => 'Ese email ya está registrado'], 409);
            }
            throw $e;
        }

        if ($result['status'] === 'expired') {
            return response()->json(['error' => 'La confirmación ha caducado. Solicita un nuevo cambio desde Ajustes'], 400);
        }
        if ($result['status'] === 'conflict') {
            return response()->json(['error' => 'Ese email ya está registrado. Solicita el cambio con otra dirección'], 409);
        }
        if ($result['status'] !== 'ok') {
            return response()->json(['error' => 'La confirmación no es válida o ya se ha utilizado'], 400);
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
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        if (hash_equals($current, $newPassword)) {
            return response()->json(['error' => 'La nueva contraseña debe ser distinta de la actual'], 422);
        }

        $user = UvhRequest::user($request);
        if (! PasswordStrength::isAcceptable($newPassword, $user->name, $user->email)) {
            return response()->json(['error' => 'La contraseña es demasiado débil'], 422);
        }

        $factorCode = is_string($factorInput) ? trim($factorInput) : '';
        $normalizedRecovery = $this->normalizeRecoveryCode($factorCode);
        $isTotp = preg_match('/^\d{6}$/D', $factorCode) === 1;
        $isRecovery = preg_match('/^[A-Z2-9]{16}$/D', $normalizedRecovery) === 1;
        if ($user->mfa_enabled && (! $isTotp && ! $isRecovery)) {
            return response()->json(['error' => 'Introduce un código de autenticación o recuperación válido'], 422);
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
            return response()->json(['error' => 'No se pudo guardar el aviso de seguridad. No se cambió la contraseña. Inténtalo de nuevo más tarde'], 503);
        } catch (MfaInfrastructureUnavailable $error) {
            report($error);

            return response()->json(['error' => 'La verificación MFA no está disponible. No se cambió la contraseña. Inténtalo de nuevo más tarde'], 503);
        }
        if ($changed === 'weak') {
            return response()->json(['error' => 'La contraseña es demasiado débil'], 422);
        }
        if ($changed === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, 'password-change');
        }
        if ($changed === 'reauth') {
            return MfaFreshness::reauthenticationRequired();
        }
        if ($changed === 'stale') {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión antes de cambiar la contraseña'], 409);
        }
        if ($changed === 'password') {
            Audit::write($user->id, 'auth.password_change_failed', 'user', $user->id, ['reason' => 'password']);

            return response()->json(['error' => 'Contraseña actual incorrecta'], 403);
        }
        if ($changed === 'factor') {
            Audit::write($user->id, 'auth.password_change_failed', 'user', $user->id, ['reason' => 'factor']);

            return response()->json(['error' => 'El código de autenticación o recuperación es incorrecto'], 403);
        }

        return response()->json(['ok' => true]);
    }

    private function appUrl(): string
    {
        return FrontendUrl::base();
    }
}
