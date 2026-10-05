<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ValidatesAuthInput;
use App\Models\AccountRecoveryRequest;
use App\Support\AccountRecoveryAdmissionException;
use App\Support\Audit;
use App\Support\Auth\AccountRecoveryAdmission;
use App\Support\Auth\AuthAccountLookup;
use App\Support\Auth\CredentialChangeResponse;
use App\Support\Ids;
use App\Support\LinkIntentRegistry;
use App\Support\MailAdmissionException;
use App\Support\PasswordStrength;
use App\Support\PrivateArtifactCleanup;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/** Public support-reviewed account recovery; admissions revalidate live authority. */
final class AccountRecoveryController
{
    use ValidatesAuthInput;

    /** Start a support-reviewed MFA recovery without exposing account state. */
    public function requestAccountRecovery(Request $request): JsonResponse
    {
        $email = trim(UvhRequest::inputString($request, 'email'));
        $captchaToken = UvhRequest::inputString($request, 'captchaToken');
        if (! $this->validEmail($email)) {
            return response()->json(['error' => 'Email inválido'], 422);
        }
        if ($captchaError = $this->captchaError($request, $captchaToken)) {
            return $captchaError;
        }

        $user = AuthAccountLookup::activeByEmail($email);
        if ($user && $user->email_verified_at && $user->mfa_enabled) {
            try {
                AccountRecoveryAdmission::request($user, $email);
            } catch (MailAdmissionException|AccountRecoveryAdmissionException) {
                // Keep the public response generic. The transactional row and
                // bearer have rolled back, so no unusable case is exposed.
            }
        }

        return response()->json([
            'ok' => true,
            'message' => 'Si la cuenta existe, está verificada y tiene MFA, recibirás un enlace para abrir el expediente.',
        ], 202);
    }

    /** Email confirmation opens the case but grants no account access. */
    public function confirmAccountRecovery(Request $request): JsonResponse
    {
        $token = UvhRequest::inputString($request, 'token');
        if (preg_match('/^[A-Za-z0-9_-]{43}$/D', $token) !== 1) {
            return response()->json(['error' => 'La confirmación no es válida o ya se ha utilizado'], 400);
        }
        $tokenHash = Ids::sha256Hex($token);
        $snapshot = AccountRecoveryRequest::where('confirmation_token_hash', $tokenHash)
            ->where('status', 'requested')->first(['id', 'user_id']);
        $result = $snapshot ? AccountRecoveryAdmission::confirm($snapshot, $tokenHash) : null;
        if (! $result) {
            return response()->json(['error' => 'La confirmación no es válida o ya se ha utilizado'], 400);
        }

        return response()->json([
            'ok' => true,
            'message' => 'El expediente está abierto. Soporte debe verificar tu identidad y dos administradores distintos deben aprobarlo.',
        ]);
    }

    /** Complete a dual-approved recovery and rotate every account credential. */
    public function completeAccountRecovery(Request $request): JsonResponse
    {
        $token = UvhRequest::inputString($request, 'token');
        $password = UvhRequest::inputString($request, 'password');
        $confirmation = trim(UvhRequest::inputString($request, 'confirmation'));
        if (preg_match('/^[A-Za-z0-9_-]{43}$/D', $token) !== 1
            || ! hash_equals('RECUPERAR MI CUENTA', $confirmation)
            || ! $this->validPassword($password)) {
            return response()->json(['error' => 'Datos de recuperación inválidos'], 422);
        }

        $snapshot = AccountRecoveryRequest::with('user')
            ->where('completion_token_hash', Ids::sha256Hex($token))
            ->where('status', 'approved')->first();
        if (! $snapshot || ! $snapshot->user || ! PasswordStrength::isAcceptable(
            $password,
            $snapshot->user->name,
            $snapshot->user->email,
        )) {
            return response()->json(['error' => $snapshot ? 'La contraseña es demasiado débil' : 'El enlace no es válido o ha caducado'], $snapshot ? 422 : 400);
        }
        $passwordHash = Hash::make($password);
        $expectedApproverIds = DB::table('account_recovery_approvals')
            ->where('request_id', $snapshot->id)
            ->orderBy('admin_user_id')
            ->pluck('admin_user_id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();
        try {
            $result = AccountRecoveryAdmission::complete($snapshot, $token, $password, $passwordHash, $expectedApproverIds);
        } catch (MailAdmissionException) {
            Audit::write((int) $snapshot->user_id, 'auth.email_delivery_failed', 'account_recovery', $snapshot->id, ['kind' => 'password_changed']);

            return response()->json(['error' => 'No se pudo guardar el aviso de seguridad. La recuperación no se completó. Inténtalo de nuevo más tarde'], 503);
        }
        if ($result['status'] === 'weak') {
            return response()->json(['error' => 'La contraseña es demasiado débil'], 422);
        }
        if ($result['status'] === 'invalid') {
            return response()->json(['error' => 'El enlace no es válido o ha caducado'], 400);
        }
        if ($result['status'] === 'approval_changed') {
            return response()->json(['error' => 'La aprobación de seguridad ha cambiado. Soporte debe revisar de nuevo el expediente'], 409);
        }
        foreach ($result['artifacts'] as $artifact) {
            PrivateArtifactCleanup::afterCommit($artifact['id'], $artifact['path']);
        }
        LinkIntentRegistry::afterCommit($result['user_id']);

        return CredentialChangeResponse::forUser($request, $result['user_id'], [
            'message' => 'La cuenta se ha recuperado. Inicia sesión con la contraseña nueva y configura MFA de nuevo.',
        ]);
    }
}
