<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\EqualizesPublicMailDuration;
use App\Http\Controllers\Concerns\ValidatesAuthInput;
use App\Models\EmailToken;
use App\Support\Audit;
use App\Support\Auth\AuthAccountLookup;
use App\Support\Auth\CredentialChangeResponse;
use App\Support\Auth\PasswordRecovery;
use App\Support\Ids;
use App\Support\MailAdmissionException;
use App\Support\PasswordStrength;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

/** Public password reset; admissions revalidate account and bearer authority. */
final class PasswordRecoveryController
{
    use EqualizesPublicMailDuration;
    use ValidatesAuthInput;

    public function forgotPassword(Request $request): JsonResponse
    {
        $startedAt = hrtime(true);
        $email = trim(UvhRequest::inputString($request, 'email'));
        $captchaToken = UvhRequest::inputString($request, 'captchaToken');
        if (! $this->validEmail($email)) {
            return response()->json(['error' => 'Email inválido'], 422);
        }
        if ($captchaError = $this->captchaError($request, $captchaToken)) {
            return $captchaError;
        }

        $user = AuthAccountLookup::activeByEmail($email);
        if ($user && $user->email_verified_at) {
            try {
                PasswordRecovery::request($user, $email);
            } catch (MailAdmissionException) {
                Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['kind' => 'reset']);
            }
        }

        $this->equalizePublicMailDuration($startedAt, 'password_reset_min_duration_ms');

        return response()->json(['ok' => true]);
    }

    public function resetPassword(Request $request): JsonResponse
    {
        $token = UvhRequest::inputString($request, 'token');
        $password = UvhRequest::inputString($request, 'password');

        if (preg_match('/^[A-Za-z0-9_-]{43}$/D', $token) !== 1 || ! $this->validPassword($password)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        if (! PasswordStrength::isAcceptable($password)) {
            return response()->json(['error' => 'La contraseña es demasiado débil'], 422);
        }

        $passwordHash = Hash::make($password);
        $tokenHash = Ids::sha256Hex($token);
        $snapshot = EmailToken::where('id', $tokenHash)
            ->where('kind', 'reset')->whereNull('used_at')->first(['id', 'user_id']);
        try {
            $userId = $snapshot ? PasswordRecovery::reset($snapshot, $tokenHash, $passwordHash, $password) : null;
        } catch (MailAdmissionException) {
            Audit::write((int) $snapshot->user_id, 'auth.email_delivery_failed', 'user', $snapshot->user_id, ['kind' => 'password_changed']);

            return response()->json(['error' => 'No se pudo guardar el aviso de seguridad. No se cambió la contraseña. Inténtalo de nuevo más tarde'], 503);
        }
        if ($userId === -1) {
            return response()->json(['error' => 'La contraseña es demasiado débil'], 422);
        }
        if ($userId === null) {
            return response()->json(['error' => 'Token inválido o caducado'], 400);
        }

        return CredentialChangeResponse::forUser($request, $userId);
    }
}
