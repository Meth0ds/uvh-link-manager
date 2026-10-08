<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\EqualizesPublicMailDuration;
use App\Http\Controllers\Concerns\ValidatesAuthInput;
use App\Models\PendingRegistration;
use App\Support\Audit;
use App\Support\Auth\AuthAccountLookup;
use App\Support\Auth\RegistrationAdmission;
use App\Support\Auth\RegistrationAttemptContext;
use App\Support\Auth\RegistrationEmailCorrection;
use App\Support\Auth\VerificationResend;
use App\Support\MailAdmissionException;
use App\Support\PasswordStrength;
use App\Support\RegistrationEdit;
use App\Support\RegistrationGate;
use App\Support\UvhRequest;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Sessionless registration proposals and mailbox activation. */
final class RegistrationController
{
    use EqualizesPublicMailDuration;
    use ValidatesAuthInput;

    public function register(Request $request): JsonResponse
    {
        $email = trim(UvhRequest::inputString($request, 'email'));
        $name = trim(UvhRequest::inputString($request, 'name'));
        $password = UvhRequest::inputString($request, 'password');
        $captchaToken = UvhRequest::inputString($request, 'captchaToken');
        $honeypot = trim(UvhRequest::inputString($request, 'website'));
        $termsVersion = UvhRequest::inputString($request, 'termsVersion');
        $privacyVersion = UvhRequest::inputString($request, 'privacyVersion');
        $acceptTerms = $request->boolean('acceptTerms');

        if (! $this->validName($name) || ! $this->validEmail($email) || ! $this->validPassword($password)
            || ! $acceptTerms || ! hash_equals(RegistrationAdmission::TERMS_VERSION, $termsVersion)
            || ! hash_equals(RegistrationAdmission::PRIVACY_VERSION, $privacyVersion)
            || $honeypot !== '') {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        if (! PasswordStrength::isAcceptable($password, $name, $email)) {
            // Deliberately generic: the client-side meter already explains the
            // strength rules, and a specific server reason would help an
            // automated attacker tune guesses.
            return response()->json(['error' => 'La contraseña es demasiado débil'], 422);
        }
        if ($captchaError = $this->captchaError($request, $captchaToken)) {
            return $captchaError;
        }

        // Pausa operativa: solo bloquea registros NUEVOS, después de validar
        // la forma (para no dar oráculos de validación distintos) y antes de
        // crear intento, pendiente, correo o cookie. Verificación, reenvío y
        // corrección de pendientes existentes siguen intactos.
        if (RegistrationGate::isPaused()) {
            return response()->json(['error' => 'Registros temporalmente pausados. Inténtalo de nuevo más tarde.', 'code' => 'registration_paused'], 503);
        }

        $email = strtolower($email);

        // La inscripción es una PROPUESTA: nombre y contraseña se validan con
        // el mismo contrato que la activación —el formulario y la API comparten
        // una sola definición de lo que esta aplicación acepta—, pero NO se
        // guardan. Nada que acredite identidad o credencial persiste antes de
        // que el buzón se demuestre: ni fila de usuario, ni workspace, ni
        // aceptación legal, ni contraseña —la activación decide todo eso con lo
        // que escribe el que abre el buzón—.
        //
        // The browser's context is independent of address occupancy. It owns
        // neither an account nor proof of the mailbox, but keeps later login
        // guidance and correction responses uniform across all outcomes.
        try {
            try {
                $outcome = RegistrationAdmission::start($email);
            } catch (QueryException $error) {
                if (($error->errorInfo[0] ?? null) !== '23505') {
                    throw $error;
                }
                // Recheck a destination claimed by a non-cooperating writer;
                // still create a durable context rather than issuing a decoy.
                $outcome = RegistrationAdmission::start($email);
            }
        } catch (MailAdmissionException) {
            Audit::write(null, 'auth.email_delivery_failed', 'user', null, ['kind' => 'verify']);

            return response()->json(['error' => 'No se pudo completar el registro. Inténtalo de nuevo más tarde'], 503);
        }

        return response()->json(['user' => null], 201)->withCookie(RegistrationEdit::forAttempt($outcome));
    }

    /** Correct the browser's requested address, without claiming any mailbox. */
    public function changeRegistrationEmail(Request $request): JsonResponse
    {
        $currentEmail = strtolower(trim(UvhRequest::inputString($request, 'currentEmail')));
        $newEmail = strtolower(trim(UvhRequest::inputString($request, 'newEmail')));
        $captchaToken = UvhRequest::inputString($request, 'captchaToken');
        $honeypot = trim(UvhRequest::inputString($request, 'website'));
        if (! $this->validEmail($currentEmail) || ! $this->validEmail($newEmail) || $currentEmail === $newEmail || $honeypot !== '') {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        if ($captchaError = $this->captchaError($request, $captchaToken)) {
            return $captchaError;
        }
        $attempt = RegistrationAttemptContext::snapshot($request, $currentEmail);
        if (! $attempt) {
            return response()->json(['error' => 'No se puede cambiar este registro'], 403);
        }
        try {
            try {
                $changed = RegistrationEmailCorrection::admit($request, $attempt, $currentEmail, $newEmail);
            } catch (QueryException $error) {
                if (($error->errorInfo[0] ?? null) !== '23505') {
                    throw $error;
                }
                // Re-run admission after a non-cooperating writer claimed the
                // address. The rolled-back generation is still unspent.
                $changed = RegistrationEmailCorrection::admit($request, $attempt, $currentEmail, $newEmail);
            }
        } catch (MailAdmissionException) {
            Audit::write(null, 'auth.email_delivery_failed', 'registration_attempt', (string) $attempt->id, ['kind' => 'verify']);

            return response()->json(['error' => 'No se pudo enviar la verificación. Inténtalo de nuevo más tarde'], 503);
        }
        if ($changed['attempt'] === null) {
            return response()->json(['error' => 'No se puede cambiar este registro'], 403);
        }

        return response()->json(['ok' => true])->withCookie(RegistrationEdit::forAttempt($changed['attempt']));
    }

    /**
     * Activate a pending registration: mailbox proof (the bearer) plus the
     * identity, legal acceptance and password typed NOW, which become the
     * account's own.
     *
     * Nothing provisional survives the activation: the password is never taken
     * from the pending registration, and neither are the name or the legal
     * acceptance. Those proposals are not credentials or evidence: any
     * anonymous `register` writes them, so honouring them would be the classic
     * pre-hijack —the attacker registers the victim's address and waits for the
     * victim to click— extended to identity: the victim would inherit the
     * attacker-chosen name, the `Workspace de …` derived from it, and a
     * contractual acceptance stamped by someone else. Here the mailbox opener
     * decides the definitive password, name and acceptance, and a later
     * anonymous registration cannot replace the row or its bearer either: there
     * is nothing left for it to install.
     */
    public function verifyEmail(Request $request): JsonResponse
    {
        $token = UvhRequest::inputString($request, 'token');
        $password = UvhRequest::inputString($request, 'password');
        $name = trim(UvhRequest::inputString($request, 'name'));
        $termsVersion = UvhRequest::inputString($request, 'termsVersion');
        $privacyVersion = UvhRequest::inputString($request, 'privacyVersion');
        $acceptTerms = $request->boolean('acceptTerms');
        // The answers are separate on purpose: they are different things for
        // the person reading the message —"your link is no good" versus
        // "choose a password of 10 to 72 characters"— and none describes the
        // account, only the request that carried it.
        if (preg_match('/^[A-Za-z0-9_-]{43}$/D', $token) !== 1) {
            return response()->json(['error' => 'Token inválido'], 422);
        }
        if (! $this->validPassword($password)) {
            return response()->json(['error' => 'La contraseña debe tener entre 10 y 72 caracteres'], 422);
        }
        // Identity and legal acceptance are decided at activation too, with the
        // same input contract as `register`. An acceptance without the exact
        // version shown is not evidence of anything.
        if (! $this->validName($name) || ! $acceptTerms
            || ! hash_equals(RegistrationAdmission::TERMS_VERSION, $termsVersion)
            || ! hash_equals(RegistrationAdmission::PRIVACY_VERSION, $privacyVersion)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        if (! PasswordStrength::isAcceptable($password)) {
            // Deliberately generic, exactly like register and reset-password.
            return response()->json(['error' => 'La contraseña es demasiado débil'], 422);
        }

        $userId = RegistrationAdmission::activate($token, $password, $name);
        if ($userId === -1) {
            return response()->json(['error' => 'La contraseña es demasiado débil'], 422);
        }
        if ($userId === null) {
            return response()->json(['error' => 'Token inválido o caducado'], 400);
        }

        return response()->json(['ok' => true]);
    }

    public function resendVerification(Request $request): JsonResponse
    {
        // Public by design: login does not create an unverified session, so a
        // user must still be able to request the message after a failed login.
        // Authenticated callers remain supported for backwards compatibility.
        //
        // El temporizador arranca aquí y se cierre en TODAS las ramas que
        // contestan `ok`: la respuesta es deliberadamente la misma para una
        // dirección conocida y una desconocida, y la latencia también debe
        // serlo —la rama que envía correo hace trabajo real y la que no se
        // amortigua hasta el mismo suelo—. Sin eso, medir la respuesta sigue
        // distinguiendo quién tiene registro pendiente.
        $startedAt = hrtime(true);
        $authenticated = UvhRequest::user($request);
        $requestedEmail = trim(UvhRequest::inputString($request, 'email'));
        $captchaToken = UvhRequest::inputString($request, 'captchaToken');
        if (! $authenticated && ($captchaError = $this->captchaError($request, $captchaToken))) {
            return $captchaError;
        }
        if ($authenticated !== null) {
            // Toda fila de usuario está verificada —el registro pendiente vive
            // en `pending_registrations`, y el login no da sesión sin verificar—,
            // así que un llamante autenticado no tiene nada pendiente que
            // reenviar. El contrato de siempre para este caso.
            return response()->json(['error' => 'El email ya está verificado'], 400);
        }
        $valid = $this->validEmail($requestedEmail);
        // Una dirección vive en una sola autoridad: fila de usuario sin
        // verificar (dato heredado o creado a mano) o registro pendiente. El
        // usuario se mira primero porque es el caso que el login ya identifica
        // («Verifica tu email») y sin reenvío no hay forma alguna de cumplir esa
        // frase: sería un callejón sin salida.
        $unverifiedUser = null;
        if ($valid) {
            $candidate = AuthAccountLookup::activeByEmail($requestedEmail);
            $unverifiedUser = $candidate !== null && ! $candidate->email_verified_at ? $candidate : null;
        }
        $pending = ($unverifiedUser === null && $valid)
            ? $this->findPendingRegistrationByEmail($requestedEmail)
            : null;
        if (! $pending && ! $unverifiedUser) {
            // Unknown and already-consumed addresses are intentionally
            // indistinguishable on the public path.
            $this->equalizePublicMailDuration($startedAt, 'resend_verification_min_duration_ms');

            return response()->json(['ok' => true]);
        }

        try {
            VerificationResend::admit($unverifiedUser ?? $pending);
        } catch (MailAdmissionException) {
            Audit::write(null, 'auth.email_delivery_failed',
                $unverifiedUser !== null ? 'user' : 'pending_registration',
                $unverifiedUser !== null ? (string) $unverifiedUser->id : (string) $pending->id,
                ['kind' => 'verify'],
            );

            // The public path is uniform: a failure to enqueue is not a fact
            // about the address either.
            $this->equalizePublicMailDuration($startedAt, 'resend_verification_min_duration_ms');

            return response()->json(['ok' => true]);
        }

        $this->equalizePublicMailDuration($startedAt, 'resend_verification_min_duration_ms');

        return response()->json(['ok' => true]);
    }

    private function findPendingRegistrationByEmail(string $email): ?PendingRegistration
    {
        return PendingRegistration::whereRaw('lower(email) = ?', [strtolower($email)])->first();
    }
}
