<?php

namespace App\Http\Controllers;

use App\Models\AccountDeletionRequest;
use App\Models\AccountRecoveryRequest;
use App\Models\AuditEvent;
use App\Models\DataExportRequest;
use App\Models\EmailChangeRequest;
use App\Models\EmailToken;
use App\Models\User;
use App\Models\UvhSession;
use App\Models\Workspace;
use App\Support\AccountRecoveryLifecycle;
use App\Support\Audit;
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
use App\Support\SessionManager;
use App\Support\Totp;
use App\Support\UvhCrypto;
use App\Support\UvhMail;
use App\Support\UvhRequest;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class AuthController
{
    private const MFA_CHALLENGE_TTL = 300; // seconds

    private const TERMS_VERSION = '2026-08-30';

    private const PRIVACY_VERSION = '2026-08-30';

    // A valid cost-12 bcrypt hash for a value that is never accepted. Unknown
    // accounts still execute password verification, reducing timing-based
    // enumeration without constructing a fresh hash per request.
    private const DUMMY_PASSWORD_HASH = '$2y$12$P9Wl1lxLHGijwkSe6u4ive1jrgOvCs2K6cRjap1xfmi0GkoOLmqLO';

    // MFA challenges and failed-attempt counters live in Laravel's shared
    // cache/rate-limiter store, not PHP process memory. This keeps MFA secure
    // when production runs multiple workers or containers.

    public function register(Request $request)
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
            || ! $acceptTerms || ! hash_equals(self::TERMS_VERSION, $termsVersion)
            || ! hash_equals(self::PRIVACY_VERSION, $privacyVersion)
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

        // One bcrypt in every branch: what the destination holds decides the
        // EFFECT below — never the response, the validation order, or the work
        // paid for upfront.
        $passwordHash = Hash::make($password);
        $token = Ids::randomToken(32);
        $tokenHash = Ids::sha256Hex($token);
        try {
            $outcome = DB::transaction(function () use ($email, $name, $passwordHash, $token, $tokenHash): array {
                $this->lockEmailAddress($email);
                $reserved = EmailChangeRequest::whereRaw('lower(new_email) = ?', [$email])
                    ->where('expires_at', '>', now())->exists();
                $pending = $reserved ? null : User::whereRaw('lower(email) = ?', [$email])
                    ->whereNull('email_verified_at')
                    ->whereNull('deleted_at')
                    ->lockForUpdate()->first();
                if ($pending instanceof User) {
                    // Anti pre-occupation: an UNVERIFIED registration never
                    // owns an address — only the mailbox owner can complete
                    // either version, so the last pending registration wins
                    // and the dead end is gone.
                    return $this->replacePendingRegistration($pending, $email, $name, $passwordHash, $token, $tokenHash);
                }
                if ($reserved || User::whereRaw('lower(email) = ?', [$email])->exists()) {
                    // A verified/soft-deleted occupant or an active reservation
                    // is never revealed and never overwritten, but the outcome
                    // pays exactly like a real registration: one orphaned
                    // admission whose token has no backing row, so the delivery
                    // jobs suppress it and no mailbox is touched.
                    $this->admitOrphanVerification($email);

                    return ['status' => 'occupied', 'user_id' => null];
                }

                $user = User::create([
                    'email' => $email,
                    'name' => $name,
                    'password_hash' => $passwordHash,
                ]);
                // These rows are business evidence, not best-effort telemetry;
                // failure must roll back the account and its default workspace.
                $this->acceptRegistrationLegal((int) $user->id, now());
                $workspace = $user->ownedWorkspaces()->create([
                    // Registration accepts a longer personal name than the
                    // workspace write contract. Keep the generated resource
                    // inside that contract instead of creating an unreadable
                    // workspace for otherwise valid registrations.
                    'name' => $this->defaultWorkspaceName($name),
                    'slug' => 'ws-'.strtolower(Ids::randomToken(6)),
                ]);
                $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
                $workspace->quota()->create(['links_limit' => 1000]);

                EmailToken::create([
                    'id' => $tokenHash,
                    'user_id' => $user->id,
                    'kind' => 'verify',
                    'expires_at' => now()->addDay(),
                ]);
                if (! UvhMail::verification(
                    $email,
                    $this->appUrl().'/auth/verify-email#token='.rawurlencode($token),
                    $tokenHash,
                )) {
                    throw new MailAdmissionException('Registration verification outbox admission failed');
                }

                return ['status' => 'created', 'user_id' => (int) $user->id];
            });
        } catch (MailAdmissionException) {
            Audit::write(null, 'auth.email_delivery_failed', 'user', null, ['kind' => 'verify']);

            return response()->json(['error' => 'No se pudo completar el registro. Inténtalo de nuevo más tarde'], 503);
        } catch (QueryException $e) {
            if (($e->errorInfo[0] ?? null) === '23505') {
                // A concurrent writer claimed the destination after the
                // advisory-locked check; answer exactly like any other taken
                // destination instead of advertising the race.
                Audit::write(null, 'auth.register_duplicate', 'user', null);

                return response()->json(['user' => null], 201);
            }
            throw $e;
        }

        // One internal audit trail per outcome; the HTTP answer never names it.
        if ($outcome['status'] === 'occupied') {
            Audit::write(null, 'auth.register_duplicate', 'user', null);
        } else {
            Audit::write($outcome['user_id'], $outcome['status'] === 'replaced'
                ? 'auth.registration_replaced'
                : 'auth.register', 'user', $outcome['user_id']);
            Audit::write($outcome['user_id'], 'auth.terms_accepted', 'consent', self::TERMS_VERSION);
            // The privacy policy is an information notice, not blanket consent
            // for every processing purpose. Record the exact notice shown.
            Audit::write($outcome['user_id'], 'auth.privacy_notice_acknowledged', 'privacy_notice', self::PRIVACY_VERSION);
        }

        return response()->json(['user' => null], 201);
    }

    /** Correct an unverified registration without ever creating a session. */
    public function changeRegistrationEmail(Request $request)
    {
        $currentEmail = trim(UvhRequest::inputString($request, 'currentEmail'));
        $newEmail = trim(UvhRequest::inputString($request, 'newEmail'));
        $password = UvhRequest::inputString($request, 'password');
        $captchaToken = UvhRequest::inputString($request, 'captchaToken');
        $honeypot = trim(UvhRequest::inputString($request, 'website'));

        if (! $this->validEmail($currentEmail) || ! $this->validEmail($newEmail)
            || strtolower($currentEmail) === strtolower($newEmail)
            || ! $this->validPassword($password)
            || $honeypot !== '') {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        if ($captchaError = $this->captchaError($request, $captchaToken)) {
            return $captchaError;
        }

        $currentEmail = strtolower($currentEmail);
        $newEmail = strtolower($newEmail);
        $user = $this->findUserByEmail($currentEmail);
        $passwordOk = Hash::check($password, $user?->password_hash ?? self::DUMMY_PASSWORD_HASH);
        if (! $user || $user->email_verified_at || ! $passwordOk) {
            return response()->json(['error' => 'No se puede cambiar este registro'], 403);
        }
        $token = Ids::randomToken(32);
        $tokenHash = Ids::sha256Hex($token);
        $verificationUrl = $this->appUrl().'/auth/verify-email#token='.rawurlencode($token);
        try {
            $changed = DB::transaction(function () use ($user, $newEmail, $tokenHash, $verificationUrl): string {
                $locked = User::where('id', $user->id)->whereNull('email_verified_at')->lockForUpdate()->first();
                if (! $locked) {
                    return 'unavailable';
                }
                $this->lockEmailAddress($newEmail);
                // Whether the destination is taken must never reach the caller.
                // `register` answers byte-for-byte the same for a duplicate
                // address, and this correction does too: the conflict is then
                // resolved by the flows that already own it — this
                // registration's verification email, or `forgot-password` for
                // the account that holds the destination.
                $taken = User::where('id', '!=', $locked->id)->whereRaw('lower(email) = ?', [$newEmail])->exists()
                    || EmailChangeRequest::whereRaw('lower(new_email) = ?', [$newEmail])->where('expires_at', '>', now())->exists();

                // The same statement on both outcomes: only a taken destination
                // leaves the address untouched.
                $locked->update($taken
                    ? ['updated_at' => now()]
                    : ['email' => $newEmail, 'updated_at' => now()]);

                if (! $taken) {
                    // The old mailbox must lose every outstanding bearer. A reset
                    // link delivered before this correction must not remain able
                    // to change credentials after the account email has moved.
                    EmailToken::where('user_id', $locked->id)
                        ->whereIn('kind', ['verify', 'reset'])
                        ->whereNull('used_at')
                        ->delete();
                    DB::table('sessions')->where('user_id', $locked->id)->whereNull('revoked_at')->update(['revoked_at' => now()]);
                    EmailToken::create([
                        'id' => $tokenHash,
                        'user_id' => $locked->id,
                        'kind' => 'verify',
                        'expires_at' => now()->addDay(),
                    ]);
                    if (! UvhMail::verification($newEmail, $verificationUrl, $tokenHash)) {
                        throw new MailAdmissionException('Registration email correction outbox admission failed');
                    }

                    return 'ok';
                }

                // A taken destination keeps the registration and its outstanding
                // bearers exactly as they are, but still pays for one outbox
                // admission of the same shape: its token has no backing row, so
                // the delivery jobs suppress the message (`MailDeliveryEligibility`
                // -> `obsolete`) and no mailbox is ever touched — least of all
                // the caller's own. Same cost and same answer either way, so a
                // timing observer learns nothing either.
                if (! UvhMail::verification($newEmail, $verificationUrl, Ids::sha256Hex(Ids::randomToken(32)))) {
                    throw new MailAdmissionException('Registration email correction outbox admission failed');
                }

                return 'conflict';
            });
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['kind' => 'verify']);

            return response()->json(['error' => 'No se pudo enviar la verificación. Inténtalo de nuevo más tarde'], 503);
        } catch (QueryException $e) {
            if (($e->errorInfo[0] ?? null) !== '23505') {
                throw $e;
            }
            // A concurrent writer claimed the destination between the check and
            // the update; the transaction rolled back untouched. Answer exactly
            // like the taken outcome instead of advertising the race.
            $changed = 'conflict';
        }
        if ($changed === 'unavailable') {
            return response()->json(['error' => 'No se puede cambiar este registro'], 403);
        }
        // One internal audit event per outcome; the HTTP answers stay identical.
        Audit::write($user->id, $changed === 'ok'
            ? 'auth.registration_email_change'
            : 'auth.registration_email_change_conflict', 'user', $user->id);

        return response()->json(['ok' => true]);
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
        $ok = Hash::check($password, $user ? $user->password_hash : self::DUMMY_PASSWORD_HASH);

        if (! $user || ! $ok) {
            return response()->json(['error' => 'Credenciales incorrectas'], 401);
        }

        // Registration is sessionless until the verification bearer token has
        // been consumed. Check before MFA so an unverified account receives
        // neither a challenge nor a session.
        if (! $user->email_verified_at) {
            return response()->json(['error' => 'Verifica tu email para continuar'], 403);
        }

        if ($user->mfa_enabled) {
            $challenge = Ids::randomToken(24);
            $this->storeMfaChallenge($challenge, $user->id, (int) $user->security_version);
            Audit::write($user->id, 'auth.mfa_challenge_issued', 'user', $user->id, null, UvhRequest::ip($request));

            return response()->json([
                'mfaRequired' => true,
                'challenge' => $challenge,
                'recoveryAvailable' => is_array($user->recovery_codes) && count($user->recovery_codes) > 0,
            ]);
        }

        // Bind the session to the credential generation checked above. A
        // concurrent password, MFA or administrative change then leaves this
        // session stale instead of accidentally blessing it with the newer
        // generation after the fact.
        $token = SessionManager::create($user->id, $request, (int) $user->security_version);
        Audit::write($user->id, 'auth.login', 'user', $user->id, ['mfa' => false], UvhRequest::ip($request));

        return response()->json(['user' => UvhRequest::publicUser($user)])
            ->withCookie(SessionManager::cookie($token));
    }

    public function mfaVerify(Request $request)
    {
        $challenge = UvhRequest::inputString($request, 'challenge');
        $code = UvhRequest::inputString($request, 'code');

        if ($challenge === '' || strlen($challenge) > 128 || ! preg_match('/^\d{6}$/', $code)) {
            return response()->json(['error' => 'Código inválido'], 422);
        }

        $ch = $this->getMfaChallenge($challenge);
        if (! $ch) {
            return response()->json(['error' => 'Sesión MFA caducada'], 401);
        }

        $user = User::where('id', $ch['user_id'])->whereNull('deleted_at')->first();
        if (! $user || ! $user->email_verified_at || ! $user->mfa_secret) {
            return response()->json(['error' => 'MFA no configurado o email no verificado'], 401);
        }
        if ((int) ($ch['security_version'] ?? 0) !== (int) $user->security_version) {
            $this->forgetMfaChallenge($challenge);

            return response()->json(['error' => 'Sesión MFA caducada'], 401);
        }

        if (MfaAttempts::tooMany($user->id, 'totp')) {
            return MfaAttempts::tooManyResponse($user->id, 'totp');
        }

        try {
            $lock = Cache::lock($this->mfaChallengeLockKey($challenge), 15);
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
            $ch = $this->getMfaChallenge($challenge);
            $user = $ch ? User::where('id', $ch['user_id'])->whereNull('deleted_at')->first() : null;
            if (! $ch || ! $user || ! $user->email_verified_at || ! $user->mfa_secret
                || (int) $ch['security_version'] !== (int) $user->security_version) {
                $this->forgetMfaChallenge($challenge);

                return response()->json(['error' => 'Sesión MFA caducada'], 401);
            }

            $secret = $this->decryptMfaSecret($user->mfa_secret);
            if ($secret === null) {
                // Keep the challenge so a recovery code remains usable when an
                // encryption-key rotation made only the TOTP factor unreadable.
                return response()->json(['error' => 'La aplicación autenticadora no está disponible. Usa un código de recuperación.'], 409);
            }
            if (! $this->consumeTotpCode($user->id, $code, $secret)) {
                MfaAttempts::recordFailure($user->id, 'totp');
                Audit::write($user->id, 'auth.mfa_failed', 'user', $user->id, ['method' => 'totp'], UvhRequest::ip($request));

                return response()->json(['error' => 'Código incorrecto'], 401);
            }
            if (! $this->consumeMfaChallenge($challenge)) {
                return response()->json(['error' => 'Sesión MFA caducada'], 401);
            }

            MfaAttempts::clear($user->id, 'totp');
            $token = SessionManager::create($user->id, $request, (int) $ch['security_version'], true);
            Audit::write($user->id, 'auth.login', 'user', $user->id, ['mfa' => true], UvhRequest::ip($request));

            return response()->json(['user' => UvhRequest::publicUser($user)])
                ->withCookie(SessionManager::cookie($token));
        } finally {
            try {
                $lock->release();
            } catch (\Throwable) {
                // The short TTL is the final safeguard if the cache backend
                // disappears after acquisition.
            }
        }
    }

    public function mfaRecovery(Request $request)
    {
        $challenge = UvhRequest::inputString($request, 'challenge');
        $code = $this->normalizeRecoveryCode(UvhRequest::inputString($request, 'code'));

        if ($challenge === '' || strlen($challenge) > 128 || ! preg_match('/^[A-Z2-9]{16}$/D', $code)) {
            return response()->json(['error' => 'Código de recuperación inválido'], 422);
        }

        $ch = $this->getMfaChallenge($challenge);
        if (! $ch) {
            return response()->json(['error' => 'Sesión MFA caducada'], 401);
        }

        $user = User::where('id', $ch['user_id'])->whereNull('deleted_at')->first();

        if (! $user || ! $user->email_verified_at || ! $user->mfa_enabled || $user->recovery_codes === null) {
            return response()->json(['error' => 'Código de recuperación incorrecto'], 401);
        }
        if ((int) ($ch['security_version'] ?? 0) !== (int) $user->security_version) {
            $this->forgetMfaChallenge($challenge);

            return response()->json(['error' => 'Sesión MFA caducada'], 401);
        }

        if (MfaAttempts::tooMany($user->id, 'recovery')) {
            return MfaAttempts::tooManyResponse($user->id, 'recovery');
        }

        try {
            $lock = Cache::lock($this->mfaChallengeLockKey($challenge), 15);
            if (! $lock->get()) {
                return response()->json(['error' => 'Esta verificación ya se está procesando'], 409);
            }
        } catch (\Throwable) {
            Audit::write($user->id, 'auth.mfa_lock_unavailable', 'user', $user->id, ['method' => 'recovery']);

            return response()->json(['error' => 'La verificación no está disponible temporalmente'], 503);
        }

        try {
            $ch = $this->getMfaChallenge($challenge);
            if (! $ch || (int) $ch['user_id'] !== (int) $user->id) {
                return response()->json(['error' => 'Sesión MFA caducada'], 401);
            }

            // Consume the one-time recovery code while locking the user row.
            // The distributed challenge lock also prevents a parallel TOTP
            // request from spending this login at the same time.
            $consumed = DB::transaction(function () use ($user, $code, $ch, $challenge, $request): array {
                $locked = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
                if (! $locked || ! $locked->email_verified_at || ! $locked->mfa_enabled
                    || ! is_array($locked->recovery_codes)
                    || (int) $locked->security_version !== (int) $ch['security_version']) {
                    return ['status' => 'invalid'];
                }
                $idx = $this->recoveryCodeIndex($locked->recovery_codes, $code);
                if ($idx === null) {
                    return ['status' => 'invalid'];
                }
                // Consume the cache challenge before committing the database
                // mutation. An unavailable replay store throws and rolls this
                // transaction back, so a recovery credential is never lost
                // without producing an authenticated session.
                if (! $this->consumeMfaChallenge($challenge)) {
                    return ['status' => 'challenge'];
                }
                $codes = $locked->recovery_codes;
                array_splice($codes, $idx, 1);
                $locked->update(['recovery_codes' => $codes]);
                $token = SessionManager::create($locked->id, $request, (int) $locked->security_version, true);

                return ['status' => 'ok', 'token' => $token];
            });
            if ($consumed['status'] === 'challenge') {
                return response()->json(['error' => 'Sesión MFA caducada'], 401);
            }
            if ($consumed['status'] !== 'ok') {
                MfaAttempts::recordFailure($user->id, 'recovery');
                Audit::write($user->id, 'auth.mfa_failed', 'user', $user->id, ['method' => 'recovery'], UvhRequest::ip($request));

                return response()->json(['error' => 'Código de recuperación incorrecto'], 401);
            }

            MfaAttempts::clear($user->id, 'recovery');
            Audit::write($user->id, 'auth.mfa_recovery', 'user', $user->id);

            $token = $consumed['token'];
            $user->refresh();
            $remainingCodes = is_array($user->recovery_codes) ? count($user->recovery_codes) : 0;
            if ($remainingCodes <= 2) {
                Audit::write($user->id, $remainingCodes === 0 ? 'auth.mfa_recovery_exhausted' : 'auth.mfa_recovery_low', 'user', $user->id, [
                    'remaining' => $remainingCodes,
                ]);
            }
            Audit::write($user->id, 'auth.login', 'user', $user->id, [
                'mfa' => 'recovery',
                'recovery_codes_remaining' => $remainingCodes,
            ], UvhRequest::ip($request));

            return response()->json(['user' => UvhRequest::publicUser($user)])
                ->withCookie(SessionManager::cookie($token));
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

    public function verifyEmail(Request $request)
    {
        $token = UvhRequest::inputString($request, 'token');
        if ($token === '' || strlen($token) > 256) {
            return response()->json(['error' => 'Token inválido'], 422);
        }

        $tokenHash = Ids::sha256Hex($token);
        $snapshot = EmailToken::where('id', $tokenHash)
            ->where('kind', 'verify')->whereNull('used_at')->first(['id', 'user_id']);
        // User first, bearer second is the global lifecycle lock order. The
        // preflight row is untrusted and every property is checked again under
        // lock, so replacement or consumption races fail closed.
        $userId = $snapshot ? DB::transaction(function () use ($snapshot, $tokenHash): ?int {
            $user = User::where('id', $snapshot->user_id)->lockForUpdate()->first();
            $row = EmailToken::where('id', $tokenHash)
                ->where('user_id', $snapshot->user_id)
                ->where('kind', 'verify')
                ->whereNull('used_at')
                ->lockForUpdate()
                ->first();
            if (! $row || $row->expires_at->isPast()) {
                return null;
            }

            if (! $user || $user->deleted_at || $user->email_verified_at) {
                return null;
            }

            $now = now();
            $row->update(['used_at' => $now]);
            $user->update(['email_verified_at' => $now, 'updated_at' => $now]);
            // A legacy deployment may have issued a session before email
            // verification became mandatory. Revoke all of them now; merely
            // waiting for a stale cookie to be used could resurrect it after
            // verification. The user must establish a fresh session by login.
            DB::table('sessions')->where('user_id', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);

            return (int) $user->id;
        }) : null;
        if ($userId === null) {
            return response()->json(['error' => 'Token inválido o caducado'], 400);
        }

        Audit::write($userId, 'auth.email_verified', 'user', $userId);

        return response()->json(['ok' => true]);
    }

    public function resendVerification(Request $request)
    {
        // Public by design: login does not create an unverified session, so a
        // user must still be able to request the message after a failed login.
        // Authenticated callers remain supported for backwards compatibility.
        $authenticated = UvhRequest::user($request);
        $requestedEmail = trim(UvhRequest::inputString($request, 'email'));
        $captchaToken = UvhRequest::inputString($request, 'captchaToken');
        if (! $authenticated && ($captchaError = $this->captchaError($request, $captchaToken))) {
            return $captchaError;
        }
        $user = $authenticated ?? ($this->validEmail($requestedEmail) ? $this->findUserByEmail($requestedEmail) : null);
        $authenticatedCall = $authenticated !== null;

        if (! $user || $user->email_verified_at) {
            if ($authenticatedCall && $user?->email_verified_at) {
                return response()->json(['error' => 'El email ya está verificado'], 400);
            }

            // Unknown and already-verified addresses are intentionally
            // indistinguishable on the public path.
            return response()->json(['ok' => true]);
        }

        $token = Ids::randomToken(32);
        $tokenHash = Ids::sha256Hex($token);
        try {
            $result = DB::transaction(function () use ($user, $token, $tokenHash): array {
                // The user lock makes cooldown, bearer replacement and outbox
                // admission one commit; no crash can expose an undeliverable token.
                $locked = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
                if (! $locked || $locked->email_verified_at) {
                    return ['status' => 'unavailable'];
                }
                $last = EmailToken::where('user_id', $locked->id)
                    ->where('kind', 'verify')->latest('created_at')->first();
                if ($last && $last->created_at->gt(now()->subSeconds(60))) {
                    return ['status' => 'cooldown'];
                }

                EmailToken::create([
                    'id' => $tokenHash,
                    'user_id' => $locked->id,
                    'kind' => 'verify',
                    'expires_at' => now()->addDay(),
                ]);
                if (! UvhMail::verification(
                    $locked->email,
                    $this->appUrl().'/auth/verify-email#token='.rawurlencode($token),
                    $tokenHash,
                )) {
                    throw new MailAdmissionException('Verification resend outbox admission failed');
                }
                EmailToken::where('user_id', $locked->id)->where('kind', 'verify')
                    ->whereNull('used_at')->where('id', '!=', $tokenHash)->delete();

                return ['status' => 'created', 'user_id' => (int) $locked->id];
            });
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['kind' => 'verify']);

            return $authenticatedCall
                ? response()->json(['error' => 'No se pudo poner en cola la verificación. Inténtalo de nuevo más tarde'], 503)
                : response()->json(['ok' => true]);
        }
        if ($result['status'] === 'cooldown') {
            return $authenticatedCall
                ? response()->json(['error' => 'Espera un minuto antes de reenviar la verificación'], 429)
                : response()->json(['ok' => true]);
        }
        if ($result['status'] !== 'created') {
            return $authenticatedCall
                ? response()->json(['error' => 'El email ya está verificado o la cuenta no está disponible'], 400)
                : response()->json(['ok' => true]);
        }

        return response()->json(['ok' => true]);
    }

    public function forgotPassword(Request $request)
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
        if ($user) {
            try {
                DB::transaction(function () use ($user, $email): void {
                    $locked = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
                    if (! $locked || strtolower($locked->email) !== strtolower($email)) {
                        return;
                    }
                    $last = EmailToken::where('user_id', $locked->id)
                        ->where('kind', 'reset')->latest('created_at')->first();
                    if ($last && $last->created_at->gt(now()->subSeconds(60))) {
                        return;
                    }
                    $newToken = Ids::randomToken(32);
                    $newTokenHash = Ids::sha256Hex($newToken);
                    EmailToken::create([
                        'id' => $newTokenHash,
                        'user_id' => $locked->id,
                        'kind' => 'reset',
                        'expires_at' => now()->addHour(),
                    ]);
                    if (! UvhMail::resetPassword(
                        $locked->email,
                        $this->appUrl().'/auth/reset-password#token='.rawurlencode($newToken),
                        $newTokenHash,
                    )) {
                        throw new MailAdmissionException('Password reset outbox admission failed');
                    }
                    EmailToken::where('user_id', $locked->id)->where('kind', 'reset')
                        ->whereNull('used_at')->where('id', '!=', $newTokenHash)->delete();
                });
            } catch (MailAdmissionException) {
                Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['kind' => 'reset']);
            }
        }

        return response()->json(['ok' => true]);
    }

    public function resetPassword(Request $request)
    {
        $token = UvhRequest::inputString($request, 'token');
        $password = UvhRequest::inputString($request, 'password');

        if ($token === '' || strlen($token) > 256 || ! $this->validPassword($password)) {
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
            $userId = $snapshot ? DB::transaction(function () use ($snapshot, $tokenHash, $passwordHash, $password): ?int {
                $user = User::where('id', $snapshot->user_id)->lockForUpdate()->first();
                $row = EmailToken::where('id', $tokenHash)
                    ->where('user_id', $snapshot->user_id)
                    ->where('kind', 'reset')
                    ->whereNull('used_at')
                    ->lockForUpdate()
                    ->first();
                if (! $row || $row->used_at || $row->expires_at->isPast()) {
                    return null;
                }

                if (! $user || $user->deleted_at) {
                    return null;
                }
                if (! PasswordStrength::isAcceptable($password, $user->name, $user->email)) {
                    // Re-evaluate with the live account identity while its row is
                    // locked. A reset must not accept a password derived from the
                    // user's name or mailbox merely because the anonymous
                    // preflight could not know that context.
                    return -1;
                }

                $now = now();
                $row->update(['used_at' => $now]);
                EmailToken::where('user_id', $user->id)->where('kind', 'reset')->whereNull('used_at')->delete();
                $user->update([
                    'password_hash' => $passwordHash,
                    'security_version' => (int) $user->security_version + 1,
                    'updated_at' => $now,
                ]);
                DB::table('sessions')->where('user_id', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
                DB::table('api_tokens')->where('created_by', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
                AccountRecoveryLifecycle::cancelActiveForUser((int) $user->id, $now);
                $this->admitPasswordChangedNotice($user);

                return (int) $user->id;
            }) : null;
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

        Audit::write($userId, 'auth.password_reset', 'user', $userId);

        return response()->json(['ok' => true]);
    }

    /**
     * Consume the explicit one-use incident bearer. Email possession can stop
     * access, but cannot authenticate, change identity or disable MFA.
     */
    public function revokeCompromisedAccess(Request $request)
    {
        $token = UvhRequest::inputString($request, 'token');
        if (preg_match('/^[A-Za-z0-9_-]{43}$/D', $token) !== 1) {
            return response()->json(['error' => 'El enlace no es válido o ya se ha utilizado'], 400);
        }

        $tokenHash = Ids::sha256Hex($token);
        $snapshot = EmailToken::where('id', $tokenHash)
            ->where('kind', 'security_revoke')->whereNull('used_at')->first(['id', 'user_id']);
        $result = $snapshot ? DB::transaction(function () use ($snapshot, $tokenHash): ?array {
            // Include soft-blocked/grace-period accounts: this link is allowed
            // to stop a hostile pending deletion, but never authenticates.
            $user = User::where('id', $snapshot->user_id)->lockForUpdate()->first();
            $row = EmailToken::where('id', $tokenHash)
                ->where('user_id', $snapshot->user_id)
                ->where('kind', 'security_revoke')
                ->whereNull('used_at')
                ->lockForUpdate()
                ->first();
            if (! $row || $row->used_at || $row->expires_at->isPast()) {
                return null;
            }
            if (! $user) {
                return null;
            }

            $deletion = AccountDeletionRequest::where('user_id', $user->id)->lockForUpdate()->first();
            if ($user->deleted_at && (! $deletion || $deletion->status !== 'scheduled')) {
                // Never let an old email undo an administrative block.
                EmailToken::where('user_id', $user->id)->where('kind', 'security_revoke')->whereNull('used_at')->update(['used_at' => now()]);

                return ['user_id' => (int) $user->id, 'artifacts' => [], 'blocked' => true];
            }

            $artifacts = DataExportRequest::where('user_id', $user->id)
                ->whereIn('status', ['requested', 'processing', 'ready'])
                ->whereNotNull('artifact_path')
                ->get(['id', 'artifact_path'])
                ->filter(fn ($export) => is_string($export->artifact_path) && $export->artifact_path !== '')
                ->map(fn ($export) => ['id' => (int) $export->id, 'path' => $export->artifact_path])
                ->values()
                ->all();
            DataExportRequest::where('user_id', $user->id)
                ->whereIn('status', ['requested', 'processing', 'ready'])
                ->update([
                    'status' => 'cancelled',
                    'confirmation_token_hash' => null,
                    'download_token_hash' => null,
                    'updated_at' => now(),
                ]);

            $now = now();
            $user->update([
                'deleted_at' => null,
                'mfa_pending_secret' => null,
                'mfa_pending_expires_at' => null,
                'security_version' => (int) $user->security_version + 1,
                'updated_at' => $now,
            ]);
            DB::table('sessions')->where('user_id', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
            DB::table('api_tokens')->where('created_by', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
            EmailChangeRequest::where('user_id', $user->id)->delete();
            EmailToken::where('user_id', $user->id)->where('kind', 'reset')->whereNull('used_at')->delete();
            EmailToken::where('user_id', $user->id)->where('kind', 'security_revoke')->whereNull('used_at')->update(['used_at' => $now]);
            AccountRecoveryLifecycle::cancelActiveForUser((int) $user->id, $now);

            if ($deletion && in_array($deletion->status, ['requested', 'scheduled'], true)) {
                $deletion->update([
                    'status' => 'cancelled',
                    'confirmation_token_hash' => null,
                    'cancel_token_hash' => null,
                    'cancelled_at' => $now,
                    'updated_at' => $now,
                ]);
            }

            return ['user_id' => (int) $user->id, 'artifacts' => $artifacts, 'blocked' => false];
        }) : null;

        if (! $result) {
            return response()->json(['error' => 'El enlace no es válido o ya se ha utilizado'], 400);
        }
        foreach ($result['artifacts'] ?? [] as $artifact) {
            PrivateArtifactCleanup::attempt($artifact['id'], $artifact['path']);
        }
        try {
            LinkIntentRegistry::revokeForUser($result['user_id']);
        } catch (\Throwable) {
            // The index and cache TTL bound residual handoffs. Access is
            // already revoked even if this secondary minimisation step fails.
        }
        Audit::write($result['user_id'], 'auth.emergency_access_revoked', 'user', $result['user_id'], [
            'administratively_blocked' => $result['blocked'],
        ]);

        return response()->json([
            'ok' => true,
            'message' => 'Los accesos y cambios pendientes han quedado revocados. Restablece tu contraseña para recuperar la cuenta.',
        ])->withCookie(SessionManager::clearCookie());
    }

    /** Start a support-reviewed MFA recovery without exposing account state. */
    public function requestAccountRecovery(Request $request)
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
        $created = null;
        if ($user && $user->email_verified_at && $user->mfa_enabled) {
            try {
                $created = DB::transaction(function () use ($user, $email): ?array {
                    $locked = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
                    if (! $locked || ! $locked->email_verified_at || ! $locked->mfa_enabled
                        || ! hash_equals(strtolower($locked->email), strtolower($email))) {
                        return null;
                    }
                    $existing = AccountRecoveryRequest::where('user_id', $locked->id)
                        ->whereIn('status', ['requested', 'email_confirmed', 'in_review', 'approved'])
                        ->lockForUpdate()->first();
                    if ($existing && ((int) $existing->security_version !== (int) $locked->security_version
                        || $existing->expires_at->isPast())) {
                        $existing->update([
                            'status' => 'expired',
                            'confirmation_token_hash' => null,
                            'completion_token_hash' => null,
                            'updated_at' => now(),
                        ]);
                        $existing = null;
                    }
                    if ($existing && ($existing->status !== 'requested'
                        || $existing->updated_at->gt(now()->subMinute()))) {
                        return null;
                    }

                    $rawToken = Ids::randomToken(32);
                    $generation = Ids::sha256Hex($rawToken);
                    $confirmationExpiresAt = now()->addHour();
                    $values = [
                        'security_version' => (int) $locked->security_version,
                        'status' => 'requested',
                        'confirmation_token_hash' => $generation,
                        'confirmation_expires_at' => $confirmationExpiresAt,
                        'completion_token_hash' => null,
                        'completion_expires_at' => null,
                        'email_confirmed_at' => null,
                        'approved_at' => null,
                        'rejected_at' => null,
                        'completed_at' => null,
                        'expires_at' => now()->addDays(7),
                    ];
                    if ($existing) {
                        DB::table('account_recovery_approvals')->where('request_id', $existing->id)->delete();
                        $existing->update($values);
                        $recovery = $existing;
                    } else {
                        $recovery = AccountRecoveryRequest::create(['user_id' => $locked->id, ...$values]);
                    }
                    $url = $this->appUrl().'/auth/account-recovery/confirm#token='.rawurlencode($rawToken);
                    if (! UvhMail::accountRecoveryConfirmation($locked->email, $url, (int) $recovery->id, $generation)) {
                        throw new MailAdmissionException('Account recovery confirmation outbox admission failed');
                    }

                    return ['user_id' => (int) $locked->id, 'request_id' => (int) $recovery->id];
                });
            } catch (MailAdmissionException) {
                // Keep the public response generic. The transactional row and
                // bearer have rolled back, so no unusable case is exposed.
                $created = null;
            }
        }
        if ($created) {
            Audit::write($created['user_id'], 'auth.account_recovery_requested', 'account_recovery', $created['request_id']);
        }

        return response()->json([
            'ok' => true,
            'message' => 'Si la cuenta existe, está verificada y tiene MFA, recibirás un enlace para abrir el expediente.',
        ], 202);
    }

    /** Email confirmation opens the case but grants no account access. */
    public function confirmAccountRecovery(Request $request)
    {
        $token = UvhRequest::inputString($request, 'token');
        if (preg_match('/^[A-Za-z0-9_-]{43}$/D', $token) !== 1) {
            return response()->json(['error' => 'La confirmación no es válida o ya se ha utilizado'], 400);
        }
        $tokenHash = Ids::sha256Hex($token);
        $snapshot = AccountRecoveryRequest::where('confirmation_token_hash', $tokenHash)
            ->where('status', 'requested')->first(['id', 'user_id']);
        $result = $snapshot ? DB::transaction(function () use ($snapshot, $tokenHash): ?array {
            $user = User::where('id', $snapshot->user_id)->lockForUpdate()->first();
            $row = AccountRecoveryRequest::where('id', $snapshot->id)
                ->where('user_id', $snapshot->user_id)
                ->where('confirmation_token_hash', $tokenHash)
                ->where('status', 'requested')->lockForUpdate()->first();
            if (! $row || ! $row->confirmation_expires_at || $row->confirmation_expires_at->isPast()
                || $row->expires_at->isPast()) {
                if ($row) {
                    $row->update(['status' => 'expired', 'confirmation_token_hash' => null, 'updated_at' => now()]);
                }

                return null;
            }
            if (! $user || $user->deleted_at || ! $user->email_verified_at || ! $user->mfa_enabled
                || (int) $user->security_version !== (int) $row->security_version) {
                $row->update(['status' => 'expired', 'confirmation_token_hash' => null, 'updated_at' => now()]);

                return null;
            }
            $row->update([
                'status' => 'email_confirmed',
                'confirmation_token_hash' => null,
                'confirmation_expires_at' => null,
                'email_confirmed_at' => now(),
                'updated_at' => now(),
            ]);

            return ['user_id' => (int) $user->id, 'request_id' => (int) $row->id];
        }) : null;
        if (! $result) {
            return response()->json(['error' => 'La confirmación no es válida o ya se ha utilizado'], 400);
        }
        Audit::write($result['user_id'], 'auth.account_recovery_email_confirmed', 'account_recovery', $result['request_id']);

        return response()->json([
            'ok' => true,
            'message' => 'El expediente está abierto. Soporte debe verificar tu identidad y dos administradores distintos deben aprobarlo.',
        ]);
    }

    /** Complete a dual-approved recovery and rotate every account credential. */
    public function completeAccountRecovery(Request $request)
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
            $result = DB::transaction(function () use ($token, $passwordHash, $snapshot, $expectedApproverIds): array {
                // Match the global recovery lock order: all known user rows in
                // primary-key order, followed by the case row. If the approval set
                // changed since the preflight read we fail closed and require a new
                // review instead of acquiring a late, out-of-order user lock.
                $lockIds = array_values(array_unique([(int) $snapshot->user_id, ...$expectedApproverIds]));
                sort($lockIds, SORT_NUMERIC);
                $lockedUsers = User::whereIn('id', $lockIds)
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->get()
                    ->keyBy('id');
                $row = AccountRecoveryRequest::where('id', $snapshot->id)
                    ->where('user_id', $snapshot->user_id)
                    ->where('completion_token_hash', Ids::sha256Hex($token))
                    ->where('status', 'approved')
                    ->lockForUpdate()
                    ->first();
                if (! $row || ! $row->completion_expires_at || $row->completion_expires_at->isPast()
                    || $row->expires_at->isPast()) {
                    if ($row) {
                        $row->update(['status' => 'expired', 'completion_token_hash' => null, 'updated_at' => now()]);
                    }

                    return ['status' => 'invalid'];
                }

                $approverIds = DB::table('account_recovery_approvals')
                    ->where('request_id', $row->id)
                    ->orderBy('admin_user_id')
                    ->pluck('admin_user_id')
                    ->map(fn ($id) => (int) $id)
                    ->unique()
                    ->values()
                    ->all();
                if ($approverIds !== $expectedApproverIds) {
                    $row->update([
                        'status' => 'in_review',
                        'completion_token_hash' => null,
                        'completion_expires_at' => null,
                        'approved_at' => null,
                        'updated_at' => now(),
                    ]);

                    return ['status' => 'approval_changed'];
                }
                $user = $lockedUsers->get($row->user_id);
                if (! $user || ! $user->email_verified_at || ! $user->mfa_enabled
                    || (int) $user->security_version !== (int) $row->security_version) {
                    $row->update(['status' => 'expired', 'completion_token_hash' => null, 'updated_at' => now()]);

                    return ['status' => 'invalid'];
                }
                $validApprovers = collect($approverIds)
                    ->unique()
                    ->filter(function (int $adminId) use ($lockedUsers): bool {
                        $admin = $lockedUsers->get($adminId);

                        return (bool) ($admin
                            && ! $admin->deleted_at
                            && $admin->email_verified_at
                            && $admin->is_admin
                            && $admin->mfa_enabled);
                    })
                    ->count();
                if ($validApprovers < 2) {
                    $row->update([
                        'status' => 'in_review',
                        'completion_token_hash' => null,
                        'completion_expires_at' => null,
                        'approved_at' => null,
                        'updated_at' => now(),
                    ]);

                    return ['status' => 'approval_changed'];
                }

                $now = now();
                $wasAdmin = (bool) $user->is_admin;
                $artifacts = DataExportRequest::where('user_id', $user->id)
                    ->whereIn('status', ['requested', 'processing', 'ready'])
                    ->whereNotNull('artifact_path')
                    ->get(['id', 'artifact_path'])
                    ->filter(fn ($export) => is_string($export->artifact_path) && $export->artifact_path !== '')
                    ->map(fn ($export) => ['id' => (int) $export->id, 'path' => $export->artifact_path])
                    ->values()
                    ->all();
                $user->update([
                    'password_hash' => $passwordHash,
                    'is_admin' => false,
                    'mfa_enabled' => false,
                    'mfa_secret' => null,
                    'mfa_pending_secret' => null,
                    'mfa_pending_expires_at' => null,
                    'recovery_codes' => null,
                    'security_version' => (int) $user->security_version + 1,
                    'updated_at' => $now,
                ]);
                DB::table('sessions')->where('user_id', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
                DB::table('api_tokens')->where('created_by', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
                EmailToken::where('user_id', $user->id)->whereIn('kind', ['reset', 'security_revoke'])->delete();
                EmailChangeRequest::where('user_id', $user->id)->delete();
                DataExportRequest::where('user_id', $user->id)
                    ->whereIn('status', ['requested', 'processing', 'ready'])
                    ->update([
                        'status' => 'cancelled',
                        'confirmation_token_hash' => null,
                        'download_token_hash' => null,
                        'updated_at' => $now,
                    ]);
                AccountDeletionRequest::where('user_id', $user->id)
                    ->whereIn('status', ['requested', 'scheduled'])
                    ->update([
                        'status' => 'cancelled',
                        'confirmation_token_hash' => null,
                        'confirmation_expires_at' => null,
                        'cancel_token_hash' => null,
                        'updated_at' => $now,
                    ]);
                $row->update([
                    'status' => 'completed',
                    'completion_token_hash' => null,
                    'completion_expires_at' => null,
                    'completed_at' => $now,
                    'updated_at' => $now,
                ]);

                $this->admitPasswordChangedNotice($user);

                return [
                    'status' => 'ok',
                    'user_id' => (int) $user->id,
                    'request_id' => (int) $row->id,
                    'was_admin' => $wasAdmin,
                    'artifacts' => $artifacts,
                ];
            });
        } catch (MailAdmissionException) {
            Audit::write((int) $snapshot->user_id, 'auth.email_delivery_failed', 'account_recovery', $snapshot->id, ['kind' => 'password_changed']);

            return response()->json(['error' => 'No se pudo guardar el aviso de seguridad. La recuperación no se completó. Inténtalo de nuevo más tarde'], 503);
        }
        if ($result['status'] === 'invalid') {
            return response()->json(['error' => 'El enlace no es válido o ha caducado'], 400);
        }
        if ($result['status'] === 'approval_changed') {
            return response()->json(['error' => 'La aprobación de seguridad ha cambiado. Soporte debe revisar de nuevo el expediente'], 409);
        }
        foreach ($result['artifacts'] as $artifact) {
            PrivateArtifactCleanup::attempt($artifact['id'], $artifact['path']);
        }
        try {
            LinkIntentRegistry::revokeForUser($result['user_id']);
        } catch (\Throwable) {
            // Session and API access are already revoked; TTL bounds cache residue.
        }
        Audit::write($result['user_id'], 'auth.account_recovery_completed', 'account_recovery', $result['request_id'], [
            'mfa_disabled' => true,
            'platform_admin_removed' => $result['was_admin'],
        ]);

        return response()->json([
            'ok' => true,
            'message' => 'La cuenta se ha recuperado. Inicia sesión con la contraseña nueva y configura MFA de nuevo.',
        ])->withCookie(SessionManager::clearCookie());
    }

    public function me(Request $request)
    {
        $user = UvhRequest::user($request)->refresh();

        return response()->json(['user' => UvhRequest::publicUser($user)]);
    }

    /** Report only session-local MFA freshness; no factor material is exposed. */
    public function mfaSessionStatus(Request $request)
    {
        $user = UvhRequest::user($request);
        $verifiedAt = UvhRequest::mfaVerifiedAt($request);
        $freshMinutes = MfaFreshness::windowMinutes();
        $fresh = (bool) $user->mfa_enabled
            && MfaFreshness::isFresh($verifiedAt);

        return response()->json([
            'enabled' => (bool) $user->mfa_enabled,
            'fresh' => $fresh,
            'verifiedAt' => $this->iso($verifiedAt),
            'expiresAt' => $verifiedAt
                ? $this->iso(CarbonImmutable::instance($verifiedAt)->addMinutes($freshMinutes))
                : null,
        ]);
    }

    /** Refresh the privileged MFA window without creating or rotating a session. */
    public function mfaReauthenticate(Request $request)
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
        $result = DB::transaction(function () use ($user, $sessionId, $password, $factorCode): array {
            $locked = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
            $session = UvhSession::where('id', $sessionId)->where('user_id', $user->id)
                ->whereNull('revoked_at')->lockForUpdate()->first();
            if (! $locked || ! $session || ! $locked->email_verified_at
                || (int) $session->security_version !== (int) $locked->security_version) {
                return ['status' => 'stale'];
            }
            if (! $locked->mfa_enabled) {
                return ['status' => 'not_configured'];
            }

            // Password plus a concrete current factor is sufficient to
            // establish a fresh privileged window, even for a legacy session
            // that predates the mfa_verified_at column.
            // mfaReauthenticate IS the freshness refresh, so it cannot require
            // a fresh window; it charges the account-wide 'reauthentication'
            // budget through MfaStepUp (password + factor failures alike).
            $stepUp = MfaStepUp::verify($locked, $session, $password, $factorCode, false, 'reauthentication');
            if ($stepUp['status'] !== 'ok') {
                return ['status' => $stepUp['status']];
            }
            if (isset($stepUp['recovery_codes'])) {
                $locked->update(['recovery_codes' => $stepUp['recovery_codes'], 'updated_at' => $stepUp['verified_at']]);
            }

            return [
                'status' => 'ok',
                'factor' => $stepUp['factor'],
                'verified_at' => $stepUp['verified_at'],
            ];
        });

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

        Audit::write($user->id, 'auth.mfa_reauthenticated', 'session', $sessionId, [
            'factor' => $result['factor'],
        ], UvhRequest::ip($request));
        $verifiedAt = $result['verified_at'];

        return response()->json([
            'ok' => true,
            'verifiedAt' => $this->iso($verifiedAt),
            'expiresAt' => $this->iso(CarbonImmutable::instance($verifiedAt)->addMinutes(MfaFreshness::windowMinutes())),
        ]);
    }

    public function profile(Request $request)
    {
        $name = trim(UvhRequest::inputString($request, 'name'));
        if (! $this->validName($name)) {
            return response()->json(['error' => 'Nombre inválido'], 422);
        }

        $user = UvhRequest::user($request);
        $sessionId = UvhRequest::sessionId($request);
        $updated = DB::transaction(function () use ($user, $sessionId, $name): ?User {
            $locked = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
            $session = UvhSession::where('id', $sessionId)->where('user_id', $user->id)
                ->whereNull('revoked_at')->lockForUpdate()->first();
            if (! $locked || ! $session
                || (int) $session->security_version !== (int) $locked->security_version
                || $session->expires_at->isPast()) {
                return null;
            }
            $locked->update(['name' => $name, 'updated_at' => now()]);

            return $locked->fresh();
        });
        if (! $updated) {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión'], 409);
        }
        Audit::write($user->id, 'auth.profile_update', 'user', $user->id);

        return response()->json(['user' => UvhRequest::publicUser($updated)]);
    }

    public function requestEmailChange(Request $request)
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
            $result = DB::transaction(function () use (
                $user,
                $sessionId,
                $newEmail,
                $password,
                $factorCode,
                $tokenHash,
                $verificationUrl,
            ): array {
                $locked = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
                $session = UvhSession::where('id', $sessionId)->where('user_id', $user->id)
                    ->whereNull('revoked_at')->lockForUpdate()->first();
                if (! $locked || ! $locked->email_verified_at || ! $session
                    || (int) $session->security_version !== (int) $locked->security_version) {
                    return ['status' => 'stale'];
                }
                // One shared step-up owns the attempt budget, the freshness
                // window and replay protection. Business conflicts only become
                // visible afterwards, so a caller without a valid factor cannot
                // probe which addresses are taken.
                $stepUp = MfaStepUp::verify($locked, $session, $password, $factorCode, true, 'email-change');
                if ($stepUp['status'] !== 'ok') {
                    return ['status' => $stepUp['status']];
                }
                $this->lockEmailAddress($newEmail);
                if (strtolower($locked->email) === $newEmail) {
                    return ['status' => 'same'];
                }
                if (User::where('id', '!=', $locked->id)->whereRaw('lower(email) = ?', [$newEmail])->exists()) {
                    return ['status' => 'conflict'];
                }

                // Expired reservations must not occupy an email indefinitely.
                EmailChangeRequest::where('expires_at', '<=', now())
                    ->where(function ($query) use ($locked, $newEmail) {
                        $query->where('user_id', $locked->id)->orWhereRaw('lower(new_email) = ?', [$newEmail]);
                    })->delete();

                EmailChangeRequest::where('user_id', $locked->id)->lockForUpdate()->first()?->delete();

                // The recovery code is charged only on the created path: a
                // same/conflict answer keeps the credential intact for a retry.
                if (isset($stepUp['recovery_codes'])) {
                    $locked->update(['recovery_codes' => $stepUp['recovery_codes'], 'updated_at' => now()]);
                }

                $expiresAt = now()->addHour();
                EmailChangeRequest::create([
                    'id' => $tokenHash,
                    'user_id' => $locked->id,
                    'new_email' => $newEmail,
                    'security_version' => (int) $locked->security_version,
                    'expires_at' => $expiresAt,
                    'created_at' => now(),
                ]);
                if (! UvhMail::emailChangeVerification($newEmail, $verificationUrl, $tokenHash)) {
                    throw new MailAdmissionException('Email change verification outbox admission failed');
                }
                // The previous mailbox must receive a durable warning in the
                // same commit as the new mailbox's bearer. If either admission
                // fails, retain the previous reservation and recovery code.
                if (! UvhMail::emailChangeRequested($locked->email)) {
                    throw new MailAdmissionException('Email change warning outbox admission failed');
                }

                return [
                    'status' => 'created',
                    'user_id' => (int) $locked->id,
                    'expires_at' => $expiresAt,
                    'factor' => $stepUp['factor'],
                ];
            });
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

        // MfaStepUp::verify already restored the account-wide budget.
        Audit::write($user->id, 'auth.email_change_requested', 'user', $user->id, [
            'factor' => $result['factor'],
            'expires_in_minutes' => 60,
        ]);

        return response()->json(['user' => UvhRequest::publicUser($user->refresh())]);
    }

    public function cancelEmailChange(Request $request)
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
            $result = DB::transaction(function () use ($user, $sessionId, $password, $factorCode): string {
                $locked = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
                $session = UvhSession::where('id', $sessionId)->where('user_id', $user->id)
                    ->whereNull('revoked_at')->lockForUpdate()->first();
                if (! $locked || ! $session || (int) $session->security_version !== (int) $locked->security_version) {
                    return 'stale';
                }
                // Same shared step-up as the request it cancels: account-wide
                // budget, freshness window and replay protection in one place.
                $stepUp = MfaStepUp::verify($locked, $session, $password, $factorCode, true, 'email-change');
                if ($stepUp['status'] !== 'ok') {
                    return $stepUp['status'];
                }
                if (isset($stepUp['recovery_codes'])) {
                    $locked->update(['recovery_codes' => $stepUp['recovery_codes'], 'updated_at' => now()]);
                }
                EmailChangeRequest::where('user_id', $locked->id)->delete();

                return 'ok';
            });
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

        Audit::write($user->id, 'auth.email_change_cancelled', 'user', $user->id);

        return response()->json(['user' => UvhRequest::publicUser($user->refresh())]);
    }

    public function confirmEmailChange(Request $request)
    {
        $token = UvhRequest::inputString($request, 'token');
        if (! preg_match('/^[A-Za-z0-9_-]{43}$/D', $token)) {
            return response()->json(['error' => 'Token inválido'], 422);
        }

        $tokenHash = Ids::sha256Hex($token);
        $snapshot = EmailChangeRequest::where('id', $tokenHash)->first(['id', 'user_id']);
        try {
            $result = $snapshot ? DB::transaction(function () use ($snapshot, $tokenHash): array {
                $user = User::where('id', $snapshot->user_id)->lockForUpdate()->first();
                $row = EmailChangeRequest::where('id', $tokenHash)
                    ->where('user_id', $snapshot->user_id)->lockForUpdate()->first();
                if (! $row) {
                    return ['status' => 'invalid'];
                }
                if ($row->expires_at->isPast()) {
                    $row->delete();

                    return ['status' => 'expired'];
                }

                if (! $user || $user->deleted_at || ! $user->email_verified_at
                    || (int) $user->security_version !== (int) $row->security_version) {
                    $row->delete();

                    return ['status' => 'invalid'];
                }
                $this->lockEmailAddress(strtolower($row->new_email));
                if (User::where('id', '!=', $user->id)->whereRaw('lower(email) = ?', [strtolower($row->new_email)])->exists()) {
                    $row->delete();

                    return ['status' => 'conflict'];
                }

                $now = now();
                $oldEmail = $user->email;
                $newEmail = strtolower($row->new_email);
                $nextVersion = (int) $user->security_version + 1;
                $user->update([
                    'email' => $newEmail,
                    'email_verified_at' => $now,
                    'security_version' => $nextVersion,
                    'updated_at' => $now,
                ]);
                DB::table('sessions')->where('user_id', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
                DB::table('api_tokens')->where('created_by', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
                EmailToken::where('user_id', $user->id)->whereIn('kind', ['verify', 'reset'])->whereNull('used_at')->delete();
                EmailChangeRequest::where('user_id', $user->id)->delete();
                AccountRecoveryLifecycle::cancelActiveForUser((int) $user->id, $now);
                // Both identity-change notices belong to this commit. Failure
                // on the second mailbox also rolls back the first envelope;
                // neither mailbox may be told about a change that was undone.
                foreach (array_unique([$oldEmail, $newEmail]) as $recipient) {
                    if (! UvhMail::emailChanged($recipient)) {
                        throw new MailAdmissionException('Email changed notices outbox admission failed');
                    }
                }

                return [
                    'status' => 'ok',
                    'user_id' => (int) $user->id,
                ];
            }) : ['status' => 'invalid'];
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

        Audit::write($result['user_id'], 'auth.email_change_confirmed', 'user', $result['user_id'], [
            'revoked_all_sessions' => true,
        ]);

        return response()->json(['ok' => true])->withCookie(SessionManager::clearCookie());
    }

    public function changePassword(Request $request)
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
            $changed = DB::transaction(function () use (
                $user,
                $sessionId,
                $current,
                $newPasswordHash,
                $factorCode,
            ): string {
                $locked = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
                $session = UvhSession::where('id', $sessionId)->where('user_id', $user->id)->whereNull('revoked_at')->lockForUpdate()->first();
                if (! $locked || ! $session || (int) $session->security_version !== (int) $locked->security_version) {
                    return 'stale';
                }
                // One shared step-up owns the attempt budget, the freshness
                // window and replay protection; the recovery-code consumption
                // it reports joins the new password in the same atomic update.
                $stepUp = MfaStepUp::verify($locked, $session, $current, $factorCode, true, 'password-change');
                if ($stepUp['status'] !== 'ok') {
                    return $stepUp['status'];
                }

                $now = now();
                $nextVersion = (int) $locked->security_version + 1;
                $updates = [
                    'password_hash' => $newPasswordHash,
                    'security_version' => $nextVersion,
                    'updated_at' => $now,
                ];
                if (isset($stepUp['recovery_codes'])) {
                    $updates['recovery_codes'] = $stepUp['recovery_codes'];
                }
                $locked->update($updates);
                $session->update([
                    'security_version' => $nextVersion,
                    'mfa_verified_at' => $locked->mfa_enabled ? $now : $session->mfa_verified_at,
                ]);
                DB::table('sessions')->where('user_id', $locked->id)->where('id', '!=', $session->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
                EmailToken::where('user_id', $locked->id)->where('kind', 'reset')->whereNull('used_at')->delete();
                AccountRecoveryLifecycle::cancelActiveForUser((int) $locked->id, $now);
                $this->admitPasswordChangedNotice($locked);

                return 'ok:'.$stepUp['factor'];
            });
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

        // MfaStepUp::verify already restored the account-wide budget.
        $factor = str_starts_with($changed, 'ok:') ? substr($changed, 3) : 'unknown';
        Audit::write($user->id, 'auth.password_change', 'user', $user->id, [
            'factor' => $factor,
            'revoked_other_sessions' => true,
        ]);

        return response()->json(['ok' => true]);
    }

    public function sessions(Request $request)
    {
        $user = UvhRequest::user($request);
        $currentId = UvhRequest::sessionId($request);
        // Bound historical rows returned to the browser. Revoked sessions are
        // retained temporarily for incident review, but an old account must
        // not turn this endpoint into an unbounded memory/query response.
        $total = $user->sessions()->count();
        // Two sessions touched in the same second are otherwise ordered
        // arbitrarily, so the hundred rows kept by the bound (and described by
        // `truncated`) would change between identical requests.
        $query = $user->sessions()->orderByDesc('last_used_at')->orderByDesc('id');
        $rows = $query->limit(100)->get()->map(fn ($s) => [
            'id' => $s->id,
            'user_agent' => $s->user_agent,
            'created_at' => $this->iso($s->created_at),
            'last_used_at' => $this->iso($s->last_used_at),
            'expires_at' => $this->iso($s->expires_at),
            'revoked_at' => $this->iso($s->revoked_at),
            'mfa_verified_at' => $this->iso($s->mfa_verified_at),
            'current' => $s->id === $currentId,
        ]);

        return response()->json(['sessions' => $rows, 'truncated' => $total > 100]);
    }

    /**
     * Account-scoped security posture without credential or network details.
     * Activity uses an explicit action allowlist and omits metadata/IP hashes.
     */
    public function securityCenter(Request $request)
    {
        $user = UvhRequest::user($request)->refresh();
        $activeSessions = $user->sessions()->whereNull('revoked_at')->where('expires_at', '>', now())->count();
        $publicUser = UvhRequest::publicUser($user);
        $passwordActions = ['auth.password_change', 'auth.password_reset', 'auth.account_recovery_completed'];
        $lastPasswordEvent = AuditEvent::where('user_id', $user->id)->whereIn('action', $passwordActions)
            ->orderByDesc('created_at')->orderByDesc('id')->first(['created_at']);
        $visibleActions = [
            'auth.login', 'auth.logout', 'auth.password_change', 'auth.password_reset',
            'auth.session_revoke', 'auth.mfa_enable', 'auth.mfa_disable', 'auth.mfa_reconfigured',
            'auth.mfa_recovery', 'auth.mfa_recovery_regenerate', 'auth.mfa_reauthenticated',
            'auth.email_change_requested', 'auth.email_change_cancelled', 'auth.email_change_confirmed',
            'auth.emergency_access_revoked', 'auth.account_recovery_completed',
        ];
        $activityRows = AuditEvent::where('user_id', $user->id)->whereIn('action', $visibleActions)
            ->orderByDesc('created_at')->orderByDesc('id')->limit(21)->get(['id', 'action', 'created_at']);
        // One row past the bound is what tells a full panel from a truncated
        // one, so the last twenty events are never read as the whole personal
        // audit trail. Same contract as the per-link activity panel.
        $activityTruncated = $activityRows->count() > 20;
        $activity = $activityRows->take(20)->map(fn (AuditEvent $event) => [
            'id' => (int) $event->id,
            'action' => $event->action,
            'createdAt' => $this->iso($event->created_at),
        ]);

        return response()->json([
            'summary' => [
                'mfaEnabled' => (bool) $user->mfa_enabled,
                'recoveryCodesRemaining' => is_array($user->recovery_codes) ? count($user->recovery_codes) : 0,
                'activeSessions' => $activeSessions,
                'currentSessionMfaVerifiedAt' => $this->iso(UvhRequest::mfaVerifiedAt($request)),
                'pendingEmail' => $publicUser['pendingEmail'],
                'pendingEmailExpiresAt' => $publicUser['pendingEmailExpiresAt'],
                'lastPasswordEventAt' => $this->iso($lastPasswordEvent?->created_at),
            ],
            'activity' => $activity,
            'truncated' => $activityTruncated,
        ]);
    }

    public function revokeSession(Request $request, string $id)
    {
        if (! preg_match('/^[a-f0-9]{64}$/D', $id)) {
            return response()->json(['error' => 'Sesión no encontrada'], 404);
        }
        $user = UvhRequest::user($request);
        $row = $user->sessions()->where('id', $id)->first();
        if (! $row) {
            return response()->json(['error' => 'Sesión no encontrada'], 404);
        }
        $current = $id === UvhRequest::sessionId($request);
        $row->update(['revoked_at' => now()]);
        Audit::write($user->id, 'auth.session_revoke', 'session', $id);

        $response = response()->json(['ok' => true, 'current' => $current]);

        return $current ? $response->withCookie(SessionManager::clearCookie()) : $response;
    }

    public function mfaSetup(Request $request)
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
        $setup = DB::transaction(function () use ($user, $sessionId, $password, $code, $encryptedSecret): string {
            $locked = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
            $session = UvhSession::where('id', $sessionId)->where('user_id', $user->id)
                ->whereNull('revoked_at')->lockForUpdate()->first();
            if (! $locked || ! $session || (int) $session->security_version !== (int) $locked->security_version) {
                return 'stale';
            }
            if (! Hash::check($password, $locked->password_hash)) {
                return 'password';
            }

            // Step-up: replacing an active factor requires a concrete current
            // TOTP or one of the one-time recovery credentials. A historical
            // session flag is never sufficient on its own.
            if ($locked->mfa_enabled) {
                $activeSecret = $this->decryptMfaSecret($locked->mfa_secret);
                $normalizedRecovery = is_string($code) ? $this->normalizeRecoveryCode($code) : '';
                $validTotp = is_string($code) && preg_match('/^\d{6}$/D', $code)
                    && $activeSecret !== null && $this->consumeTotpCode($locked->id, $code, $activeSecret);
                $recoveryIndex = is_string($code) && preg_match('/^[A-Z2-9]{16}$/D', $normalizedRecovery)
                    && is_array($locked->recovery_codes)
                    ? $this->recoveryCodeIndex($locked->recovery_codes, $normalizedRecovery)
                    : null;
                $validRecovery = $recoveryIndex !== null;
                if (! $validTotp && ! $validRecovery) {
                    return 'totp';
                }
            }

            $updates = [
                'mfa_pending_secret' => $encryptedSecret,
                'mfa_pending_expires_at' => now()->addMinutes(10),
            ];
            if (isset($validRecovery) && $validRecovery && isset($recoveryIndex)) {
                $remainingCodes = $locked->recovery_codes;
                array_splice($remainingCodes, $recoveryIndex, 1);
                $updates['recovery_codes'] = $remainingCodes;
            }
            $locked->update($updates);

            return 'ok';
        });
        if ($setup === 'stale') {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión antes de configurar MFA'], 409);
        }
        if ($setup === 'password') {
            return response()->json(['error' => 'Contraseña incorrecta'], 403);
        }
        if ($setup !== 'ok') {
            return response()->json(['error' => 'Código de autenticación o recuperación requerido para reconfigurar MFA'], 403);
        }
        $uri = Totp::provisioningUri($user->email, 'UVH', $secret);

        Audit::write($user->id, 'auth.mfa_setup', 'user', $user->id);

        return response()->json(['secret' => $secret, 'uri' => $uri]);
    }

    public function mfaEnable(Request $request)
    {
        $code = UvhRequest::inputString($request, 'code');
        if (! preg_match('/^\d{6}$/', $code)) {
            return response()->json(['error' => 'Código inválido'], 422);
        }

        $user = UvhRequest::user($request);
        $sessionId = UvhRequest::sessionId($request);
        $recoveryCodes = $this->newRecoveryCodes();

        try {
            $enabled = DB::transaction(function () use ($user, $sessionId, $code, $recoveryCodes): string {
                $locked = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
                $session = UvhSession::where('id', $sessionId)->where('user_id', $user->id)->whereNull('revoked_at')->lockForUpdate()->first();
                if (! $locked || ! $session || (int) $session->security_version !== (int) $locked->security_version
                    || ! $locked->mfa_pending_secret || ! $locked->mfa_pending_expires_at || $locked->mfa_pending_expires_at->isPast()) {
                    return 'invalid';
                }
                $pendingSecret = $this->decryptMfaSecret($locked->mfa_pending_secret);
                if ($pendingSecret === null || ! $this->consumeTotpCode($locked->id, $code, $pendingSecret)) {
                    return 'invalid';
                }

                $now = now();
                $reconfigured = (bool) $locked->mfa_enabled;
                $nextVersion = (int) $locked->security_version + 1;
                $locked->update([
                    'mfa_secret' => $locked->mfa_pending_secret,
                    'mfa_pending_secret' => null,
                    'mfa_pending_expires_at' => null,
                    'mfa_enabled' => true,
                    'recovery_codes' => array_map(fn ($value) => Ids::sha256Hex($value), $recoveryCodes),
                    'security_version' => $nextVersion,
                    'updated_at' => $now,
                ]);
                $session->update(['security_version' => $nextVersion, 'mfa_verified_at' => $now]);
                DB::table('sessions')->where('user_id', $locked->id)->where('id', '!=', $session->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
                AccountRecoveryLifecycle::cancelActiveForUser((int) $locked->id, $now);
                // Security notices without bearers are still mandatory: commit
                // the factor, recovery hashes and encrypted notice together.
                if (! UvhMail::mfaEnabled($locked->email, $reconfigured)) {
                    throw new MailAdmissionException('MFA enable notice outbox admission failed');
                }

                return $reconfigured ? 'reconfigured' : 'enabled';
            });
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['operation' => 'mfa_enable']);

            return response()->json(['error' => 'No se pudo guardar el aviso de seguridad. No se modificó MFA. Espera al siguiente código del autenticador e inténtalo de nuevo'], 503);
        }
        if ($enabled === 'invalid') {
            Audit::write($user->id, 'auth.mfa_enable_failed', 'user', $user->id);

            return response()->json(['error' => 'La configuración MFA ha caducado o el código es incorrecto'], 403);
        }

        Audit::write($user->id, $enabled === 'reconfigured' ? 'auth.mfa_reconfigured' : 'auth.mfa_enable', 'user', $user->id, [
            'recovery_codes_issued' => count($recoveryCodes),
        ]);

        return response()->json([
            'recoveryCodes' => array_map(fn (string $value) => $this->formatRecoveryCode($value), $recoveryCodes),
        ]);
    }

    /** Discard a staged MFA factor without touching the currently active one. */
    public function mfaCancelSetup(Request $request)
    {
        $user = UvhRequest::user($request);

        DB::transaction(function () use ($user): void {
            $locked = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
            if (! $locked) {
                return;
            }

            $locked->update([
                'mfa_pending_secret' => null,
                'mfa_pending_expires_at' => null,
            ]);
        });

        Audit::write($user->id, 'auth.mfa_setup_cancel', 'user', $user->id);

        return response()->json(['ok' => true]);
    }

    /** Replace every recovery credential after a fresh password + factor check. */
    public function mfaRegenerateRecoveryCodes(Request $request)
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
            $result = DB::transaction(function () use (
                $user,
                $sessionId,
                $password,
                $factorCode,
                $recoveryCodes,
            ): array {
                $locked = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
                $session = UvhSession::where('id', $sessionId)->where('user_id', $user->id)
                    ->whereNull('revoked_at')->lockForUpdate()->first();
                if (! $locked || ! $session || ! $locked->mfa_enabled
                    || (int) $session->security_version !== (int) $locked->security_version) {
                    return ['status' => 'stale'];
                }

                // One owner of password + factor + anti-replay + attempt budget
                // + the privileged window. Regeneration replaces the complete
                // set afterwards, so the recovery-code consumption MfaStepUp
                // reports is deliberately discarded (no separate delete first).
                $stepUp = MfaStepUp::verify($locked, $session, $password, $factorCode);
                if ($stepUp['status'] !== 'ok') {
                    return ['status' => $stepUp['status']];
                }

                $now = $stepUp['verified_at'];
                $nextVersion = (int) $locked->security_version + 1;
                $locked->update([
                    'recovery_codes' => array_map(fn (string $value) => Ids::sha256Hex($value), $recoveryCodes),
                    'security_version' => $nextVersion,
                    'updated_at' => $now,
                ]);
                $session->update(['security_version' => $nextVersion]);
                DB::table('sessions')->where('user_id', $locked->id)->where('id', '!=', $session->id)
                    ->whereNull('revoked_at')->update(['revoked_at' => $now]);
                AccountRecoveryLifecycle::cancelActiveForUser((int) $locked->id, $now);
                if (! UvhMail::mfaRecoveryCodesRegenerated($locked->email)) {
                    throw new MailAdmissionException('MFA recovery codes notice outbox admission failed');
                }

                return ['status' => 'ok', 'factor' => $stepUp['factor']];
            });
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

        Audit::write($user->id, 'auth.mfa_recovery_regenerate', 'user', $user->id, ['revoked_other_sessions' => true]);

        return response()->json([
            'recoveryCodes' => array_map(fn (string $value) => $this->formatRecoveryCode($value), $recoveryCodes),
        ]);
    }

    public function mfaDisable(Request $request)
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
            $disabled = DB::transaction(function () use ($user, $sessionId, $password, $code): string {
                $locked = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
                $session = UvhSession::where('id', $sessionId)->where('user_id', $user->id)->whereNull('revoked_at')->lockForUpdate()->first();
                if (! $locked || ! $session || (int) $session->security_version !== (int) $locked->security_version) {
                    return 'stale';
                }
                // Disabling MFA always demands a concrete, current factor; the
                // shared step-up's password-only shortcut never covers it.
                $stepUp = MfaStepUp::verify($locked, $session, $password, $code, true, 'mfa-disable');
                if ($stepUp['status'] !== 'ok') {
                    return $stepUp['status'];
                }
                if ($stepUp['factor'] === 'password_only') {
                    return 'invalid';
                }
                // Platform administration is MFA-gated. Keeping an administrator
                // flag on an account without MFA creates an unusable operator and
                // can lock the platform out when it is the last administrator.
                if ($locked->is_admin) {
                    return 'admin_required';
                }

                $now = $stepUp['verified_at'];
                $nextVersion = (int) $locked->security_version + 1;
                $locked->update([
                    'mfa_enabled' => false,
                    'mfa_secret' => null,
                    'mfa_pending_secret' => null,
                    'mfa_pending_expires_at' => null,
                    'recovery_codes' => null,
                    'security_version' => $nextVersion,
                    'updated_at' => $now,
                ]);
                $session->update(['security_version' => $nextVersion, 'mfa_verified_at' => null]);
                DB::table('sessions')->where('user_id', $locked->id)->where('id', '!=', $session->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
                AccountRecoveryLifecycle::cancelActiveForUser((int) $locked->id, $now);
                if (! UvhMail::mfaDisabled($locked->email)) {
                    throw new MailAdmissionException('MFA disable notice outbox admission failed');
                }

                return 'ok';
            });
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

        Audit::write($user->id, 'auth.mfa_disable', 'user', $user->id);

        return response()->json(['ok' => true]);
    }

    // ---------------- helpers ----------------

    /**
     * Admit the incident bearer and encrypted notice in the credential commit.
     *
     * Callers must already hold the user's row lock. Do not open a separate
     * transaction or swallow admission failures here: a crash must not commit
     * new credentials without a recoverable security notice. Provider delivery
     * remains after-commit and is not a prerequisite for changing credentials.
     */
    private function admitPasswordChangedNotice(User $lockedUser): void
    {
        if (DB::transactionLevel() < 1) {
            throw new \LogicException('Security notice requires the credential transaction');
        }

        $token = Ids::randomToken(32);
        $tokenHash = Ids::sha256Hex($token);
        EmailToken::create([
            'id' => $tokenHash,
            'user_id' => $lockedUser->id,
            'kind' => 'security_revoke',
            'expires_at' => now()->addDay(),
        ]);
        $url = $this->appUrl().'/auth/security-incident#token='.rawurlencode($token);
        if (! UvhMail::passwordChanged($lockedUser->email, $url, $tokenHash)) {
            throw new MailAdmissionException('Security notice outbox admission failed');
        }

        // Retain this new bearer plus four previous notices. Excluding the new
        // ID avoids pruning it when timestamps tie and random hashes determine
        // the order; a just-admitted notice must not be obsolete at commit.
        $staleIds = EmailToken::where('user_id', $lockedUser->id)
            ->where('kind', 'security_revoke')
            ->whereNull('used_at')
            ->where('id', '!=', $tokenHash)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->offset(4)
            ->limit(100)
            ->pluck('id');
        if ($staleIds->isNotEmpty()) {
            EmailToken::whereIn('id', $staleIds)->delete();
        }
    }

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

    /**
     * Replace an UNVERIFIED registration when the same mailbox claims the
     * address again. Only the mailbox owner can ever complete either version
     * (the verification bearer lands in their inbox), so the last pending
     * registration wins and every bearer of the replaced one dies with it.
     *
     * @return array{status: string, user_id: int|null}
     */
    private function replacePendingRegistration(User $pending, string $email, string $name, string $passwordHash, string $token, string $tokenHash): array
    {
        $now = now();
        $pending->update([
            'name' => $name,
            'password_hash' => $passwordHash,
            'security_version' => (int) $pending->security_version + 1,
            'updated_at' => $now,
        ]);
        // The replaced registration's bearers must not outlive it: an old
        // verification link cannot activate an account it no longer describes,
        // a delivered reset link cannot touch the new credentials, and legacy
        // sessions lose their standing with the bumped security version.
        EmailToken::where('user_id', $pending->id)->whereNull('used_at')->delete();
        DB::table('sessions')->where('user_id', $pending->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
        EmailChangeRequest::where('user_id', $pending->id)->delete();

        // The default workspace and its quota survive (they belong to the
        // account); only the derived display name follows the new registration.
        $workspace = $pending->ownedWorkspaces()->orderBy('id')->first();
        if ($workspace instanceof Workspace) {
            $workspace->update(['name' => $this->defaultWorkspaceName($name)]);
        }
        $this->acceptRegistrationLegal((int) $pending->id, $now);
        EmailToken::create([
            'id' => $tokenHash,
            'user_id' => $pending->id,
            'kind' => 'verify',
            'expires_at' => $now->addDay(),
        ]);
        if (! UvhMail::verification(
            $email,
            $this->appUrl().'/auth/verify-email#token='.rawurlencode($token),
            $tokenHash,
        )) {
            throw new MailAdmissionException('Registration verification outbox admission failed');
        }

        return ['status' => 'replaced', 'user_id' => (int) $pending->id];
    }

    /**
     * Pay for one outbox admission exactly like a real registration without
     * ever mailing the occupant: the token hash has no backing row, so the
     * delivery jobs suppress the envelope (`MailDeliveryEligibility` ->
     * `obsolete`) and no mailbox is touched — least of all the caller's own.
     */
    private function admitOrphanVerification(string $email): void
    {
        if (! UvhMail::verification(
            $email,
            $this->appUrl().'/auth/verify-email#token='.rawurlencode(Ids::randomToken(32)),
            Ids::sha256Hex(Ids::randomToken(32)),
        )) {
            throw new MailAdmissionException('Registration verification outbox admission failed');
        }
    }

    /**
     * Registration legal acceptance: business evidence of THIS request. The
     * table allows one row per user/document/version
     * (`legal_acceptance_user_document_unique`), so a replacement registration
     * refreshes the acceptance of the current version — the acceptance that
     * counts is the one made by the registration that survives — instead of
     * colliding with the registration it just superseded.
     */
    private function acceptRegistrationLegal(int $userId, Carbon $acceptedAt): void
    {
        foreach ([
            ['document_type' => 'terms', 'version' => self::TERMS_VERSION],
            ['document_type' => 'privacy_notice', 'version' => self::PRIVACY_VERSION],
        ] as $document) {
            DB::table('legal_acceptances')->updateOrInsert(
                ['user_id' => $userId, ...$document],
                ['source' => 'registration', 'accepted_at' => $acceptedAt],
            );
        }
    }

    private function findUserByEmail(string $email): ?User
    {
        return User::whereRaw('lower(email) = ?', [strtolower($email)])->whereNull('deleted_at')->first();
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

    private function defaultWorkspaceName(string $userName): string
    {
        $prefix = 'Workspace de ';
        $maximumWorkspaceCharacters = 80;
        $availableCharacters = $maximumWorkspaceCharacters - mb_strlen($prefix, 'UTF-8');

        // mb_substr counts Unicode code points, matching the backend's name
        // validation and the frontend decoder's explicit code-point count.
        return $prefix.mb_substr($userName, 0, $availableCharacters, 'UTF-8');
    }

    private function appUrl(): string
    {
        return rtrim((string) config('app.url'), '/');
    }

    /** Serialize claims across users and pending email-change reservations. */
    private function lockEmailAddress(string $email): void
    {
        // A collision only causes harmless extra serialization. Using a
        // transaction-scoped PostgreSQL advisory lock closes the race between
        // registration and confirmation across two different tables.
        $key = (int) sprintf('%u', crc32('uvh:email:'.strtolower($email)));
        DB::select('SELECT pg_advisory_xact_lock(?)', [$key]);
    }

    private function iso(mixed $value): ?string
    {
        return IsoDate::format($value);
    }

    private function mfaChallengeKey(string $challenge): string
    {
        return 'uvh:mfa:challenge:'.Ids::sha256Hex($challenge);
    }

    private function storeMfaChallenge(string $challenge, int $userId, int $securityVersion): void
    {
        try {
            $stored = Cache::put(
                $this->mfaChallengeKey($challenge),
                ['user_id' => $userId, 'security_version' => $securityVersion],
                now()->addSeconds(self::MFA_CHALLENGE_TTL),
            );
            if ($stored === false) {
                throw new \RuntimeException('MFA challenge store rejected write');
            }
        } catch (\Throwable $error) {
            throw new MfaInfrastructureUnavailable('MFA challenge store unavailable', 0, $error);
        }
    }

    /** @return array{user_id: int, security_version: int}|null */
    private function getMfaChallenge(string $challenge): ?array
    {
        if ($challenge === '' || strlen($challenge) > 128) {
            return null;
        }
        try {
            $value = Cache::get($this->mfaChallengeKey($challenge));
        } catch (\Throwable $error) {
            throw new MfaInfrastructureUnavailable('MFA challenge store unavailable', 0, $error);
        }

        return is_array($value) && isset($value['user_id'], $value['security_version'])
            ? ['user_id' => (int) $value['user_id'], 'security_version' => (int) $value['security_version']]
            : null;
    }

    private function forgetMfaChallenge(string $challenge): void
    {
        try {
            Cache::forget($this->mfaChallengeKey($challenge));
        } catch (\Throwable $error) {
            throw new MfaInfrastructureUnavailable('MFA challenge store unavailable', 0, $error);
        }
    }

    private function consumeMfaChallenge(string $challenge): bool
    {
        $key = $this->mfaChallengeKey($challenge);
        if ($this->getMfaChallenge($challenge) === null) {
            return false;
        }
        try {
            $reserved = Cache::add($key.':consumed', true, now()->addSeconds(self::MFA_CHALLENGE_TTL));
        } catch (\Throwable $error) {
            throw new MfaInfrastructureUnavailable('MFA challenge store unavailable', 0, $error);
        }
        if (! $reserved) {
            return false;
        }

        try {
            Cache::forget($key);
        } catch (\Throwable $error) {
            // The consumed marker was already persisted. Report an explicit
            // infrastructure outage rather than a generic 500; the caller
            // must start a new challenge and cannot replay this one.
            throw new MfaInfrastructureUnavailable('MFA challenge store unavailable', 0, $error);
        }

        return true;
    }

    private function mfaChallengeLockKey(string $challenge): string
    {
        return $this->mfaChallengeKey($challenge).':lock';
    }

    private function decryptMfaSecret(?string $encrypted): ?string
    {
        if (! is_string($encrypted) || $encrypted === '') {
            return null;
        }

        try {
            return UvhCrypto::decryptAtRest($encrypted);
        } catch (\Throwable) {
            return null;
        }
    }

    /** Consume one TOTP counter once per concrete factor across all workers. */
    private function consumeTotpCode(int $userId, string $code, string $secret): bool
    {
        $counter = Totp::matchingCounter($code, $secret);
        if ($counter === null) {
            return false;
        }

        $factor = substr(hash('sha256', $secret), 0, 24);

        try {
            return Cache::add(
                'uvh:mfa:totp-used:'.$userId.':'.$factor.':'.$counter,
                true,
                now()->addMinutes(3),
            );
        } catch (\Throwable $error) {
            throw new MfaInfrastructureUnavailable('MFA replay store unavailable', 0, $error);
        }
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

    /** Constant-time comparison across the small fixed recovery set. */
    private function recoveryCodeIndex(array $hashes, string $code): ?int
    {
        $target = Ids::sha256Hex($code);
        $match = null;
        foreach ($hashes as $index => $hash) {
            if (is_string($hash) && strlen($hash) === 64 && hash_equals($hash, $target)) {
                $match = (int) $index;
            }
        }

        return $match;
    }
}
