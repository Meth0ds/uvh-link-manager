<?php

namespace App\Http\Controllers;

use App\Models\AccountRecoveryRequest;
use App\Models\EmailChangeRequest;
use App\Models\EmailToken;
use App\Models\PendingRegistration;
use App\Models\User;
use App\Support\AccountRecoveryAdmissionException;
use App\Support\Audit;
use App\Support\Auth\AccountQueries;
use App\Support\Auth\AccountReadContext;
use App\Support\Auth\AccountRecoveryAdmission;
use App\Support\Auth\AuthenticatedPasswordChange;
use App\Support\Auth\CompromisedAccessRevocation;
use App\Support\Auth\CredentialChangeResponse;
use App\Support\Auth\EmailChangeAdmission;
use App\Support\Auth\EmailChangeReservationConflict;
use App\Support\Auth\LoginAdmission;
use App\Support\Auth\MfaChallengeStore;
use App\Support\Auth\MfaConfigurationAdmission;
use App\Support\Auth\MfaLoginAdmission;
use App\Support\Auth\PasswordRecovery;
use App\Support\Auth\ProfileAdmission;
use App\Support\Auth\ReauthenticationAdmission;
use App\Support\Auth\RegistrationAdmission;
use App\Support\Auth\RegistrationAttemptContext;
use App\Support\Auth\RegistrationEmailCorrection;
use App\Support\Auth\SessionRevocationAdmission;
use App\Support\Auth\VerificationResend;
use App\Support\FrontendUrl;
use App\Support\HCaptcha;
use App\Support\Ids;
use App\Support\IsoDate;
use App\Support\LinkIntentRegistry;
use App\Support\MailAdmissionException;
use App\Support\MfaAttempts;
use App\Support\MfaFreshness;
use App\Support\MfaInfrastructureUnavailable;
use App\Support\MfaStepUp;
use App\Support\PasswordStrength;
use App\Support\PrivateArtifactCleanup;
use App\Support\RegistrationEdit;
use App\Support\SessionManager;
use App\Support\Totp;
use App\Support\UvhCrypto;
use App\Support\UvhRequest;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class AuthController
{
    // A valid cost-12 bcrypt hash for a value that is never accepted. Unknown
    // accounts still execute password verification, reducing timing-based
    // enumeration without constructing a fresh hash per request.
    private const DUMMY_PASSWORD_HASH = '$2y$12$P9Wl1lxLHGijwkSe6u4ive1jrgOvCs2K6cRjap1xfmi0GkoOLmqLO';

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

    public function login(Request $request)
    {
        $email = trim(UvhRequest::inputString($request, 'email'));
        $password = UvhRequest::inputString($request, 'password');
        $captchaToken = UvhRequest::inputString($request, 'captchaToken');

        if (! $this->validEmail($email) || $password === '' || strlen($password) > 72) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        if ($captchaError = $this->captchaError($request, $captchaToken)) {
            return $captchaError;
        }

        $user = $this->findUserByEmail($email);
        // A pending registration stores no password. Always pay the same hash
        // cost as an unknown address before checking whether this browser owns
        // its registration edit secret; a bare email must never reveal it.
        $ok = Hash::check($password, $user ? $user->password_hash : self::DUMMY_PASSWORD_HASH);

        if (! $ok || $user === null) {
            if (RegistrationAttemptContext::owns($request, strtolower($email))) {
                return response()->json(['error' => 'Revisa la solicitud de verificación de tu email', 'reason' => 'pending_registration'], 403);
            }

            return response()->json(['error' => 'Credenciales incorrectas'], 401);
        }

        // Registration is sessionless until the verification bearer token has
        // been consumed. Check before MFA so an unverified account receives
        // neither a challenge nor a session.
        if (! $user->email_verified_at) {
            return response()->json([
                'error' => 'Confirma tu email para continuar',
                'reason' => 'email_verification_required',
            ], 403);
        }

        // Password verification is deliberately outside the lock. Revalidate
        // its exact generation before granting a session and reporting success.
        $login = LoginAdmission::admit($user, $request);
        if (! $login) {
            return response()->json(['error' => 'Credenciales incorrectas'], 401);
        }

        if ($login['mfaRequired'] ?? false) {
            return response()->json($login);
        }

        return response()->json(['user' => UvhRequest::publicUser($login['user'])])
            ->withCookie(SessionManager::cookie($login['token']));
    }

    public function mfaVerify(Request $request): JsonResponse
    {
        $challenge = UvhRequest::inputString($request, 'challenge');
        $code = UvhRequest::inputString($request, 'code');

        if ($challenge === '' || strlen($challenge) > 128 || ! preg_match('/^\d{6}$/', $code)) {
            return response()->json(['error' => 'Código inválido'], 422);
        }

        $ch = MfaChallengeStore::get($challenge);
        if (! $ch) {
            return response()->json(['error' => 'Sesión MFA caducada'], 401);
        }

        $user = User::where('id', $ch['user_id'])->whereNull('deleted_at')->first();
        if (! $user || ! $user->email_verified_at || ! $user->mfa_secret) {
            return response()->json(['error' => 'MFA no configurado o email no verificado'], 401);
        }
        if ((int) ($ch['security_version'] ?? 0) !== (int) $user->security_version) {
            MfaChallengeStore::forget($challenge);

            return response()->json(['error' => 'Sesión MFA caducada'], 401);
        }

        if (MfaAttempts::tooMany($user->id, 'totp')) {
            return MfaAttempts::tooManyResponse($user->id, 'totp');
        }

        try {
            $lock = Cache::lock(MfaChallengeStore::lockKey($challenge), 15);
            if (! $lock->get()) {
                return response()->json(['error' => 'Esta verificación ya se está procesando'], 409);
            }
        } catch (\Throwable) {
            Audit::write($user->id, 'auth.mfa_lock_unavailable', 'user', $user->id, ['method' => 'totp']);

            return response()->json(['error' => 'La verificación no está disponible temporalmente'], 503);
        }

        try {
            // Re-read both challenge and identity after taking the distributed
            // lock. TOTP and recovery then cannot race to consume one login.
            $ch = MfaChallengeStore::get($challenge);
            $user = $ch ? User::where('id', $ch['user_id'])->whereNull('deleted_at')->first() : null;
            if (! $ch || ! $user || ! $user->email_verified_at || ! $user->mfa_secret
                || (int) $ch['security_version'] !== (int) $user->security_version) {
                MfaChallengeStore::forget($challenge);

                return response()->json(['error' => 'Sesión MFA caducada'], 401);
            }

            $verified = MfaLoginAdmission::totp((int) $user->id, (int) $ch['security_version'], $challenge, $code, $request);
            if ($verified['status'] === 'unreadable') {
                return response()->json(['error' => 'La aplicación autenticadora no está disponible. Usa un código de recuperación.'], 409);
            }
            if ($verified['status'] === 'factor') {
                MfaAttempts::recordFailure($user->id, 'totp');
                Audit::write($user->id, 'auth.mfa_failed', 'user', $user->id, ['method' => 'totp'], UvhRequest::ip($request));

                return response()->json(['error' => 'Código incorrecto'], 401);
            }
            if ($verified['status'] !== 'ok') {
                return response()->json(['error' => 'Sesión MFA caducada'], 401);
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
            return response()->json(['error' => 'Código de recuperación inválido'], 422);
        }

        $ch = MfaChallengeStore::get($challenge);
        if (! $ch) {
            return response()->json(['error' => 'Sesión MFA caducada'], 401);
        }

        $user = User::where('id', $ch['user_id'])->whereNull('deleted_at')->first();

        if (! $user || ! $user->email_verified_at || ! $user->mfa_enabled || $user->recovery_codes === null) {
            return response()->json(['error' => 'Código de recuperación incorrecto'], 401);
        }
        if ((int) ($ch['security_version'] ?? 0) !== (int) $user->security_version) {
            MfaChallengeStore::forget($challenge);

            return response()->json(['error' => 'Sesión MFA caducada'], 401);
        }

        if (MfaAttempts::tooMany($user->id, 'recovery')) {
            return MfaAttempts::tooManyResponse($user->id, 'recovery');
        }

        try {
            $lock = Cache::lock(MfaChallengeStore::lockKey($challenge), 15);
            if (! $lock->get()) {
                return response()->json(['error' => 'Esta verificación ya se está procesando'], 409);
            }
        } catch (\Throwable) {
            Audit::write($user->id, 'auth.mfa_lock_unavailable', 'user', $user->id, ['method' => 'recovery']);

            return response()->json(['error' => 'La verificación no está disponible temporalmente'], 503);
        }

        try {
            $ch = MfaChallengeStore::get($challenge);
            if (! $ch || (int) $ch['user_id'] !== (int) $user->id) {
                return response()->json(['error' => 'Sesión MFA caducada'], 401);
            }

            // Consume the one-time recovery code while locking the user row.
            // The distributed challenge lock also prevents a parallel TOTP
            // request from spending this login at the same time.
            $consumed = MfaLoginAdmission::recovery((int) $user->id, (int) $ch['security_version'], $challenge, $code, $request);
            if ($consumed['status'] === 'challenge') {
                return response()->json(['error' => 'Sesión MFA caducada'], 401);
            }
            if ($consumed['status'] !== 'ok') {
                MfaAttempts::recordFailure($user->id, 'recovery');
                Audit::write($user->id, 'auth.mfa_failed', 'user', $user->id, ['method' => 'recovery'], UvhRequest::ip($request));

                return response()->json(['error' => 'Código de recuperación incorrecto'], 401);
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

    public function logout(Request $request)
    {
        $sessionId = UvhRequest::sessionId($request);
        if ($sessionId) {
            SessionManager::revoke($sessionId);
            Audit::write(UvhRequest::user($request)?->id, 'auth.logout', 'session', $sessionId);
        }

        return response()->json(['ok' => true])->withCookie(SessionManager::clearCookie());
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
            $candidate = $this->findUserByEmail($requestedEmail);
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

    /**
     * Iguala el coste de las ramas que contestan `ok` hasta el suelo de
     * configured for each public mail request.
     *
     * La rama completa (transacción + token + admisión al outbox) suele pasar
     * el suelo por sí sola; las ramas que no envían —dirección desconocida,
     * cooldown, consumo concurrente, fallo de admisión— duermen el resto. El
     * residuo que queda fuera del suelo (la varianza de la base de datos bajo
     * carga) está documentado como límite conocido de la compensación temporal.
     */
    private function equalizePublicMailDuration(float $startedAt, string $configKey): void
    {
        $floorMs = max(0, (int) config('uvh.'.$configKey));
        $remainingUs = ($floorMs * 1000) - (hrtime(true) - $startedAt) / 1000;
        if ($remainingUs > 0) {
            usleep((int) round($remainingUs));
        }
    }

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

        $user = $this->findUserByEmail($email);
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

    /**
     * Consume the explicit one-use incident bearer. Email possession can stop
     * access, but cannot authenticate, change identity or disable MFA.
     */
    public function revokeCompromisedAccess(Request $request): JsonResponse
    {
        $token = UvhRequest::inputString($request, 'token');
        if (preg_match('/^[A-Za-z0-9_-]{43}$/D', $token) !== 1) {
            return response()->json(['error' => 'El enlace no es válido o ya se ha utilizado'], 400);
        }

        $tokenHash = Ids::sha256Hex($token);
        $snapshot = EmailToken::where('id', $tokenHash)
            ->where('kind', 'security_revoke')->whereNull('used_at')->first(['id', 'user_id']);
        $result = $snapshot ? CompromisedAccessRevocation::admit($snapshot, $tokenHash) : null;

        if (! $result) {
            return response()->json(['error' => 'El enlace no es válido o ya se ha utilizado'], 400);
        }
        foreach ($result['artifacts'] as $artifact) {
            PrivateArtifactCleanup::afterCommit($artifact['id'], $artifact['path']);
        }
        try {
            LinkIntentRegistry::revokeForUser($result['user_id']);
        } catch (\Throwable) {
            // The index and cache TTL bound residual handoffs. Access is
            // already revoked even if this secondary minimisation step fails.
        }

        return CredentialChangeResponse::forUser($request, $result['user_id'], [
            'message' => 'Los accesos y cambios pendientes han quedado revocados. Restablece tu contraseña para recuperar la cuenta.',
        ]);
    }

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

        $user = $this->findUserByEmail($email);
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
        try {
            LinkIntentRegistry::revokeForUser($result['user_id']);
        } catch (\Throwable) {
            // Session and API access are already revoked; TTL bounds cache residue.
        }

        return CredentialChangeResponse::forUser($request, $result['user_id'], [
            'message' => 'La cuenta se ha recuperado. Inicia sesión con la contraseña nueva y configura MFA de nuevo.',
        ]);
    }

    public function me(Request $request): JsonResponse
    {
        $context = AccountReadContext::resolve(UvhRequest::user($request), UvhRequest::sessionId($request));
        if ($context === null) {
            return response()->json(['error' => 'No autenticado'], 401);
        }

        return response()->json(AccountQueries::me($context));
    }

    /** Report only session-local MFA freshness; no factor material is exposed. */
    public function mfaSessionStatus(Request $request): JsonResponse
    {
        $context = AccountReadContext::resolve(UvhRequest::user($request), UvhRequest::sessionId($request));
        if ($context === null) {
            return response()->json(['error' => 'No autenticado'], 401);
        }

        return response()->json(AccountQueries::mfaSession($context));
    }

    /** Refresh the privileged MFA window without creating or rotating a session. */
    public function mfaReauthenticate(Request $request): JsonResponse
    {
        $password = UvhRequest::inputString($request, 'password');
        $factorCode = trim(UvhRequest::inputString($request, 'factorCode'));
        if ($password === '' || strlen($password) > 72 || strlen($factorCode) > 24) {
            return response()->json(['error' => 'Introduce tu contraseña y segundo factor'], 422);
        }

        $user = UvhRequest::user($request);
        if (MfaAttempts::tooMany($user->id, 'reauthentication')) {
            return MfaAttempts::tooManyResponse($user->id, 'reauthentication');
        }

        $sessionId = UvhRequest::sessionId($request);
        $result = ReauthenticationAdmission::admit($user, $sessionId, $password, $factorCode, UvhRequest::ip($request));

        if ($result['status'] === 'stale') {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión'], 409);
        }
        if ($result['status'] === 'not_configured') {
            return response()->json(['error' => 'Activa MFA antes de acceder a administración'], 403);
        }
        if ($result['status'] === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, 'reauthentication');
        }
        if ($result['status'] !== 'ok') {
            Audit::write($user->id, 'auth.mfa_reauthentication_failed', 'session', $sessionId, [
                'reason' => $result['status'] === 'password' ? 'password' : 'factor',
            ], UvhRequest::ip($request));

            return response()->json(['error' => 'Contraseña o segundo factor incorrecto'], 403);
        }

        $verifiedAt = $result['verified_at'];

        return response()->json([
            'ok' => true,
            'verifiedAt' => $this->iso($verifiedAt),
            'expiresAt' => $this->iso(CarbonImmutable::instance($verifiedAt)->addMinutes(MfaFreshness::windowMinutes())),
        ]);
    }

    public function profile(Request $request): JsonResponse
    {
        $name = trim(UvhRequest::inputString($request, 'name'));
        if (! $this->validName($name)) {
            return response()->json(['error' => 'Nombre inválido'], 422);
        }

        $user = UvhRequest::user($request);
        $sessionId = UvhRequest::sessionId($request);
        $updated = ProfileAdmission::update($user, $sessionId, $name);
        if (! $updated) {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión'], 409);
        }

        return response()->json(['user' => UvhRequest::publicUser($updated)]);
    }

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

    public function sessions(Request $request): JsonResponse
    {
        $context = AccountReadContext::resolve(UvhRequest::user($request), UvhRequest::sessionId($request));
        if ($context === null) {
            return response()->json(['error' => 'No autenticado'], 401);
        }

        return response()->json(AccountQueries::sessions($context));
    }

    /**
     * Account-scoped security posture without credential or network details.
     * Activity uses an explicit action allowlist and omits metadata/IP hashes.
     */
    public function securityCenter(Request $request): JsonResponse
    {
        $context = AccountReadContext::resolve(UvhRequest::user($request), UvhRequest::sessionId($request));
        if ($context === null) {
            return response()->json(['error' => 'No autenticado'], 401);
        }

        return response()->json(AccountQueries::securityCenter($context));
    }

    public function revokeSession(Request $request, string $id): JsonResponse
    {
        if (! preg_match('/^[a-f0-9]{64}$/D', $id)) {
            return response()->json(['error' => 'Sesión no encontrada'], 404);
        }
        $user = UvhRequest::user($request);
        $currentId = UvhRequest::sessionId($request);
        $current = $id === $currentId;
        try {
            $found = SessionRevocationAdmission::revoke($user, $currentId, $id);
        } catch (MailAdmissionException) {
            return response()->json(['error' => 'No se pudo guardar el aviso de seguridad. No se revocó la sesión. Inténtalo de nuevo.'], 503);
        }
        if (! $found) {
            return response()->json(['error' => 'Sesión no encontrada'], 404);
        }

        $response = response()->json(['ok' => true, 'current' => $current]);

        return $current ? $response->withCookie(SessionManager::clearCookie()) : $response;
    }

    /**
     * Cierre masivo conservando la sesión que llama: revoca todas las demás
     * sesiones sin cerrar de la cuenta. No toca credenciales ni exige step-up,
     * igual que la revocación individual, y es idempotente. El contador es de
     * filas cerradas ahora, incluidas las que expiraron sin cerrarse antes.
     */
    public function revokeOtherSessions(Request $request): JsonResponse
    {
        $user = UvhRequest::user($request);
        $currentId = UvhRequest::sessionId($request);
        try {
            // El aviso de seguridad se admite en la misma transacción que el
            // cierre, como en el cambio de contraseña: sin aviso entregable no
            // se cierra nada, y una repetición sin filas que cerrar no manda
            // otro correo.
            $revoked = SessionRevocationAdmission::others($user, $currentId);
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['kind' => 'sessions_revoked_others']);

            return response()->json(['error' => 'No se pudo guardar el aviso de seguridad. No se cerró ninguna sesión. Inténtalo de nuevo más tarde'], 503);
        }
        if ($revoked < 0) {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión antes de cerrar accesos.'], 409);
        }

        return response()->json(['ok' => true, 'revoked' => $revoked]);
    }

    /**
     * Cierre total: revoca todas las sesiones de la cuenta, incluida la actual,
     * y limpia la cookie para que este navegador no vuelva a presentar la fila
     * muerta. La cuenta queda fuera en todos los dispositivos.
     */
    public function revokeAllSessions(Request $request): JsonResponse
    {
        $user = UvhRequest::user($request);
        $currentId = UvhRequest::sessionId($request);
        try {
            $revoked = SessionRevocationAdmission::all($user, $currentId);
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['kind' => 'sessions_revoked_all']);

            return response()->json(['error' => 'No se pudo guardar el aviso de seguridad. No se cerró ninguna sesión. Inténtalo de nuevo más tarde'], 503);
        }
        if ($revoked < 0) {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión antes de cerrar accesos.'], 409);
        }

        return response()->json(['ok' => true, 'revoked' => $revoked])->withCookie(SessionManager::clearCookie());
    }

    public function mfaSetup(Request $request): JsonResponse
    {
        $password = UvhRequest::inputString($request, 'password');
        $codeInput = $request->input('code');

        if ($password === '' || strlen($password) > 72 || ($codeInput !== null && ! is_string($codeInput))) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        $code = is_string($codeInput) ? trim($codeInput) : null;

        $user = UvhRequest::user($request);
        $sessionId = UvhRequest::sessionId($request);
        $secret = Totp::generateSecret();
        $encryptedSecret = UvhCrypto::encryptAtRest($secret);
        $setup = MfaConfigurationAdmission::setup($user, $sessionId, $password, $code, $encryptedSecret);
        if ($setup === 'stale') {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión antes de configurar MFA'], 409);
        }
        if ($setup === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, 'mfa-setup');
        }
        if ($setup === 'reauth') {
            return MfaFreshness::reauthenticationRequired();
        }
        if ($setup === 'password') {
            return response()->json(['error' => 'Contraseña incorrecta'], 403);
        }
        if ($setup !== 'ok') {
            return response()->json(['error' => 'Código de autenticación o recuperación requerido para reconfigurar MFA'], 403);
        }
        $uri = Totp::provisioningUri($user->email, 'UVH', $secret);

        return response()->json(['secret' => $secret, 'uri' => $uri]);
    }

    public function mfaEnable(Request $request): JsonResponse
    {
        $code = UvhRequest::inputString($request, 'code');
        if (! preg_match('/^\d{6}$/', $code)) {
            return response()->json(['error' => 'Código inválido'], 422);
        }

        $user = UvhRequest::user($request);
        $sessionId = UvhRequest::sessionId($request);
        $recoveryCodes = $this->newRecoveryCodes();

        try {
            $enabled = MfaConfigurationAdmission::enable($user, $sessionId, $code, $recoveryCodes);
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['operation' => 'mfa_enable']);

            return response()->json(['error' => 'No se pudo guardar el aviso de seguridad. No se modificó MFA. Espera al siguiente código del autenticador e inténtalo de nuevo'], 503);
        }
        if ($enabled === 'stale') {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión antes de activar MFA.'], 409);
        }
        if ($enabled === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, 'mfa-enable');
        }
        if ($enabled === 'invalid') {
            Audit::write($user->id, 'auth.mfa_enable_failed', 'user', $user->id);

            return response()->json(['error' => 'La configuración MFA ha caducado o el código es incorrecto'], 403);
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
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión antes de cancelar la configuración MFA.'], 409);
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
            return response()->json(['error' => 'Contraseña y segundo factor requeridos'], 422);
        }

        $user = UvhRequest::user($request);
        $sessionId = UvhRequest::sessionId($request);
        $recoveryCodes = $this->newRecoveryCodes();

        try {
            $result = MfaConfigurationAdmission::regenerate($user, $sessionId, $password, $factorCode, $recoveryCodes);
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['operation' => 'mfa_recovery_regenerate']);

            return response()->json(['error' => 'No se pudo guardar el aviso de seguridad. Los códigos anteriores siguen vigentes. Inténtalo de nuevo más tarde'], 503);
        }
        if ($result['status'] === 'stale') {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión antes de regenerar códigos'], 409);
        }
        if ($result['status'] === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, MfaStepUp::ATTEMPT_PURPOSE);
        }
        if ($result['status'] === 'reauth') {
            return MfaFreshness::reauthenticationRequired();
        }
        if ($result['status'] === 'password') {
            Audit::write($user->id, 'auth.mfa_recovery_regenerate_failed', 'user', $user->id, ['reason' => 'password']);

            return response()->json(['error' => 'Contraseña incorrecta'], 403);
        }
        if ($result['status'] !== 'ok') {
            Audit::write($user->id, 'auth.mfa_recovery_regenerate_failed', 'user', $user->id, ['reason' => 'factor']);

            return response()->json(['error' => 'El código de autenticación o recuperación es incorrecto'], 403);
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
            return response()->json(['error' => 'Contraseña y segundo factor requeridos'], 422);
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

            return response()->json(['error' => 'No se pudo guardar el aviso de seguridad. MFA sigue activo. Inténtalo de nuevo más tarde'], 503);
        } catch (MfaInfrastructureUnavailable $error) {
            report($error);

            return response()->json(['error' => 'La verificación MFA no está disponible. MFA sigue activo. Inténtalo de nuevo más tarde'], 503);
        }
        if ($disabled === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, 'mfa-disable');
        }
        if ($disabled === 'reauth') {
            return MfaFreshness::reauthenticationRequired();
        }
        if ($disabled === 'stale') {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión'], 409);
        }
        if ($disabled === 'admin_required') {
            return response()->json(['error' => 'Retira primero el rol de administrador de plataforma antes de desactivar MFA'], 409);
        }
        if ($disabled !== 'ok') {
            Audit::write($user->id, 'auth.mfa_disable_failed', 'user', $user->id);

            return response()->json(['error' => 'Contraseña o segundo factor incorrecto'], 403);
        }

        return response()->json(['ok' => true]);
    }

    /** Serialize account security mutations and revalidate the middleware snapshot. */
    // ---------------- helpers ----------------

    private function captchaError(Request $request, string $token): ?JsonResponse
    {
        $result = HCaptcha::verifyAuthentication($request, $token);
        if ($result === HCaptcha::VALID) {
            return null;
        }
        if ($result === HCaptcha::UNAVAILABLE) {
            return response()->json([
                'error' => 'La verificación antiabuso no está disponible. Espera un momento y vuelve a intentarlo.',
            ], 503);
        }

        // Deliberately generic: do not expose whether a passcode was expired,
        // malformed or already redeemed.
        return response()->json([
            'error' => 'Completa de nuevo la verificación antiabuso.',
        ], 422);
    }

    private function findUserByEmail(string $email): ?User
    {
        return User::whereRaw('lower(email) = ?', [strtolower($email)])->whereNull('deleted_at')->first();
    }

    private function findPendingRegistrationByEmail(string $email): ?PendingRegistration
    {
        return PendingRegistration::whereRaw('lower(email) = ?', [strtolower($email)])->first();
    }

    private function validEmail(string $email): bool
    {
        return $email !== '' && strlen($email) <= 254 && filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
    }

    private function validPassword(string $password): bool
    {
        return strlen($password) >= 10 && strlen($password) <= 72;
    }

    private function validName(string $name): bool
    {
        if (! mb_check_encoding($name, 'UTF-8')) {
            return false;
        }
        $len = mb_strlen($name);

        return $len >= 2 && $len <= 80 && ! preg_match('/[\x00-\x1f\x7f]/', $name);
    }

    private function appUrl(): string
    {
        return FrontendUrl::base();
    }

    private function iso(mixed $value): ?string
    {
        return IsoDate::format($value);
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

    private function normalizeRecoveryCode(string $code): string
    {
        return strtoupper((string) preg_replace('/[\s-]+/', '', trim($code)));
    }

    private function formatRecoveryCode(string $code): string
    {
        return implode('-', str_split($code, 4));
    }
}
