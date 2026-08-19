<?php

namespace App\Http\Controllers;

use App\Models\EmailToken;
use App\Models\User;
use App\Support\Audit;
use App\Support\Captcha;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\Totp;
use App\Support\UvhCrypto;
use App\Support\UvhMail;
use App\Support\UvhRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\RateLimiter;

class AuthController
{
    private const MFA_CHALLENGE_TTL = 300; // seconds

    private const TERMS_VERSION = '2026-08-19';

    private const MFA_MAX_ATTEMPTS = 10;

    private const MFA_ATTEMPT_WINDOW = 900; // seconds

    // MFA challenges and failed-attempt counters live in Laravel's shared
    // cache/rate-limiter store, not PHP process memory. This keeps MFA secure
    // when production runs multiple workers or containers.

    public function captcha(Request $request)
    {
        return response()->json(Captcha::issue($request));
    }

    public function register(Request $request)
    {
        $email = trim((string) $request->input('email', ''));
        $name = trim((string) $request->input('name', ''));
        $password = (string) $request->input('password', '');
        $captchaChallenge = (string) $request->input('captchaChallenge', '');
        $captchaAnswer = trim((string) $request->input('captchaAnswer', ''));
        $honeypot = trim((string) $request->input('website', ''));
        $termsVersion = (string) $request->input('termsVersion', '');
        $acceptTerms = $request->boolean('acceptTerms');

        if (! $this->validName($name) || ! $this->validEmail($email) || ! $this->validPassword($password)
            || ! $acceptTerms || ! hash_equals(self::TERMS_VERSION, $termsVersion)
            || $honeypot !== '' || ! Captcha::verify($request, $captchaChallenge, $captchaAnswer)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $email = strtolower($email);
        $exists = User::whereRaw('lower(email) = ?', [$email])->exists();

        if ($exists) {
            // Anti-enumeration: byte-for-byte identical response to a fresh
            // registration (201 + { user: null }); dummy bcrypt for timing.
            Audit::write(null, 'auth.register_duplicate', 'user', null);
            Hash::make($password);

            return response()->json(['user' => null], 201);
        }

        $passwordHash = Hash::make($password);

        $userId = DB::transaction(function () use ($email, $name, $passwordHash) {
            $user = User::create([
                'email' => $email,
                'name' => $name,
                'password_hash' => $passwordHash,
            ]);
            $workspace = $user->ownedWorkspaces()->create([
                'name' => "Workspace de {$name}",
                'slug' => 'ws-'.strtolower(Ids::randomToken(6)),
            ]);
            $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
            $workspace->quota()->create(['links_limit' => 1000]);

            return $user->id;
        });

        $token = Ids::randomToken(32);
        EmailToken::create([
            'id' => Ids::sha256Hex($token),
            'user_id' => $userId,
            'kind' => 'verify',
            'expires_at' => now()->addDay(),
        ]);
        UvhMail::verification($email, $this->appUrl().'/auth/verify-email?token='.rawurlencode($token));

        Audit::write($userId, 'auth.register', 'user', $userId);
        Audit::write($userId, 'auth.terms_accepted', 'consent', self::TERMS_VERSION);

        return response()->json(['user' => null], 201);
    }

    /** Correct an unverified registration without ever creating a session. */
    public function changeRegistrationEmail(Request $request)
    {
        $currentEmail = trim((string) $request->input('currentEmail', ''));
        $newEmail = trim((string) $request->input('newEmail', ''));
        $password = (string) $request->input('password', '');
        $captchaChallenge = (string) $request->input('captchaChallenge', '');
        $captchaAnswer = trim((string) $request->input('captchaAnswer', ''));
        $honeypot = trim((string) $request->input('website', ''));

        if (! $this->validEmail($currentEmail) || ! $this->validEmail($newEmail)
            || strtolower($currentEmail) === strtolower($newEmail)
            || ! $this->validPassword($password)
            || $honeypot !== '' || ! Captcha::verify($request, $captchaChallenge, $captchaAnswer)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $currentEmail = strtolower($currentEmail);
        $newEmail = strtolower($newEmail);
        $user = $this->findUserByEmail($currentEmail);
        $dummyHash = '$2a$12$/GUN2z.VnhsX9hCNc/gLLeqmo0rqp7vEF.MoYHWfxDG8X7AnJCx32';
        $passwordOk = Hash::check($password, $user?->password_hash ?? $dummyHash);
        if (! $user || $user->email_verified_at || ! $passwordOk) {
            return response()->json(['error' => 'No se puede cambiar este registro'], 403);
        }
        if (User::whereRaw('lower(email) = ?', [$newEmail])->exists()) {
            return response()->json(['error' => 'Ese email ya está registrado'], 409);
        }

        $token = Ids::randomToken(32);
        DB::transaction(function () use ($user, $currentEmail, $newEmail, $token) {
            $user->update(['email' => $newEmail, 'updated_at' => now()]);
            EmailToken::where('user_id', $user->id)->where('kind', 'verify')->whereNull('used_at')->delete();
            DB::table('sessions')->where('user_id', $user->id)->whereNull('revoked_at')->update(['revoked_at' => now()]);
            EmailToken::create([
                'id' => Ids::sha256Hex($token),
                'user_id' => $user->id,
                'kind' => 'verify',
                'expires_at' => now()->addDay(),
            ]);
        });
        UvhMail::verification($newEmail, $this->appUrl().'/auth/verify-email?token='.rawurlencode($token));
        Audit::write($user->id, 'auth.registration_email_change', 'user', $user->id, ['from' => $currentEmail, 'to' => $newEmail]);

        return response()->json(['ok' => true]);
    }

    public function login(Request $request)
    {
        $email = trim((string) $request->input('email', ''));
        $password = (string) $request->input('password', '');

        if (! $this->validEmail($email) || $password === '' || strlen($password) > 128) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $user = $this->findUserByEmail($email);
        $dummyHash = '$2a$12$/GUN2z.VnhsX9hCNc/gLLeqmo0rqp7vEF.MoYHWfxDG8X7AnJCx32';
        $ok = Hash::check($password, $user ? $user->password_hash : $dummyHash);

        if (! $user || ! $ok) {
            return response()->json(['error' => 'Credenciales incorrectas'], 401);
        }

        // Registration is sessionless until the verification bearer token has
        // been consumed. Check before MFA so an unverified account receives
        // neither a challenge nor a session.
        if (! $user->email_verified_at) {
            return response()->json(['error' => 'Verifica tu email para continuar'], 403);
        }

        Audit::write($user->id, 'auth.login', 'user', $user->id);

        if ($user->mfa_enabled) {
            $challenge = Ids::randomToken(24);
            $this->storeMfaChallenge($challenge, $user->id);

            return response()->json(['mfaRequired' => true, 'challenge' => $challenge]);
        }

        $token = SessionManager::create($user->id, $request);

        return response()->json(['user' => UvhRequest::publicUser($user)])
            ->withCookie(SessionManager::cookie($token));
    }

    public function mfaVerify(Request $request)
    {
        $challenge = (string) $request->input('challenge', '');
        $code = (string) $request->input('code', '');

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

        if ($this->mfaTooManyAttempts($user->id)) {
            return response()->json(['error' => 'Demasiados intentos. Espera unos minutos.'], 429);
        }

        if (! Totp::verify($code, UvhCrypto::decryptAtRest($user->mfa_secret))) {
            $this->mfaRecordFailure($user->id);

            return response()->json(['error' => 'Código incorrecto'], 401);
        }

        $this->clearMfaAttempts($user->id);
        $this->forgetMfaChallenge($challenge);

        $token = SessionManager::create($user->id, $request);

        return response()->json(['user' => UvhRequest::publicUser($user)])
            ->withCookie(SessionManager::cookie($token));
    }

    public function mfaRecovery(Request $request)
    {
        $email = trim((string) $request->input('email', ''));
        $code = trim((string) $request->input('code', ''));

        if (! $this->validEmail($email) || $code === '' || strlen($code) > 128) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $user = $this->findUserByEmail($email);

        if (! $user || ! $user->email_verified_at || ! $user->mfa_enabled || $user->recovery_codes === null) {
            return response()->json(['error' => 'Código de recuperación incorrecto'], 401);
        }

        if ($this->mfaTooManyAttempts($user->id)) {
            return response()->json(['error' => 'Demasiados intentos. Espera unos minutos.'], 429);
        }

        // Consume the one-time recovery code while locking the user row. Two
        // concurrent requests must not both spend the same code and create
        // separate sessions.
        $consumed = DB::transaction(function () use ($user, $code): bool {
            $locked = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
            if (! $locked || ! $locked->mfa_enabled || ! is_array($locked->recovery_codes)) {
                return false;
            }
            $hash = Ids::sha256Hex(strtoupper($code));
            $idx = array_search($hash, $locked->recovery_codes, true);
            if ($idx === false) {
                return false;
            }
            $codes = $locked->recovery_codes;
            array_splice($codes, $idx, 1);
            $locked->update(['recovery_codes' => $codes]);
            return true;
        });
        if (! $consumed) {
            $this->mfaRecordFailure($user->id);

            return response()->json(['error' => 'Código de recuperación incorrecto'], 401);
        }

        $this->clearMfaAttempts($user->id);

        Audit::write($user->id, 'auth.mfa_recovery', 'user', $user->id);

        $token = SessionManager::create($user->id, $request);

        return response()->json(['user' => UvhRequest::publicUser($user)])
            ->withCookie(SessionManager::cookie($token));
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
        $token = (string) $request->input('token', '');
        if ($token === '' || strlen($token) > 256) {
            return response()->json(['error' => 'Token inválido'], 422);
        }

        // Lock both rows while consuming the bearer token. A concurrent click
        // on the same email link must not produce two successful verifications.
        $userId = DB::transaction(function () use ($token): ?int {
            $row = EmailToken::where('id', Ids::sha256Hex($token))
                ->where('kind', 'verify')
                ->whereNull('used_at')
                ->lockForUpdate()
                ->first();
            if (! $row || $row->expires_at->isPast()) {
                return null;
            }

            $user = User::where('id', $row->user_id)
                ->whereNull('deleted_at')
                ->lockForUpdate()
                ->first();
            if (! $user || $user->email_verified_at) {
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
        });
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
        $requestedEmail = trim((string) $request->input('email', ''));
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

        $last = EmailToken::where('user_id', $user->id)->where('kind', 'verify')->latest('created_at')->first();
        if ($last && now()->diffInSeconds($last->created_at) < 60) {
            return $authenticatedCall
                ? response()->json(['error' => 'Espera un minuto antes de reenviar la verificación'], 429)
                : response()->json(['ok' => true]);
        }

        $token = Ids::randomToken(32);
        EmailToken::create([
            'id' => Ids::sha256Hex($token),
            'user_id' => $user->id,
            'kind' => 'verify',
            'expires_at' => now()->addDay(),
        ]);
        UvhMail::verification($user->email, $this->appUrl().'/auth/verify-email?token='.rawurlencode($token));

        return response()->json(['ok' => true]);
    }

    public function forgotPassword(Request $request)
    {
        $email = trim((string) $request->input('email', ''));
        if (! $this->validEmail($email)) {
            return response()->json(['error' => 'Email inválido'], 422);
        }

        $user = $this->findUserByEmail($email);
        if ($user) {
            $token = Ids::randomToken(32);
            EmailToken::create([
                'id' => Ids::sha256Hex($token),
                'user_id' => $user->id,
                'kind' => 'reset',
                'expires_at' => now()->addHour(),
            ]);
            UvhMail::resetPassword($user->email, $this->appUrl().'/auth/reset-password?token='.rawurlencode($token));
        }

        return response()->json(['ok' => true]);
    }

    public function resetPassword(Request $request)
    {
        $token = (string) $request->input('token', '');
        $password = (string) $request->input('password', '');

        if ($token === '' || ! $this->validPassword($password)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $passwordHash = Hash::make($password);
        $userId = DB::transaction(function () use ($token, $passwordHash): ?int {
            // Lock the token while checking and consuming it. A reset bearer
            // token is one-time even when two requests arrive concurrently.
            $row = EmailToken::where('id', Ids::sha256Hex($token))
                ->where('kind', 'reset')
                ->lockForUpdate()
                ->first();
            if (! $row || $row->used_at || $row->expires_at->isPast()) {
                return null;
            }

            $now = now();
            $row->update(['used_at' => $now]);
            User::where('id', $row->user_id)->update(['password_hash' => $passwordHash, 'updated_at' => $now]);
            DB::table('sessions')->where('user_id', $row->user_id)->whereNull('revoked_at')->update(['revoked_at' => $now]);

            return (int) $row->user_id;
        });
        if ($userId === null) {
            return response()->json(['error' => 'Token inválido o caducado'], 400);
        }

        Audit::write($userId, 'auth.password_reset', 'user', $userId);

        return response()->json(['ok' => true]);
    }

    public function me(Request $request)
    {
        $user = UvhRequest::user($request)->refresh();

        return response()->json(['user' => UvhRequest::publicUser($user)]);
    }

    public function profile(Request $request)
    {
        $name = trim((string) $request->input('name', ''));
        if (! $this->validName($name)) {
            return response()->json(['error' => 'Nombre inválido'], 422);
        }

        $user = UvhRequest::user($request);
        $user->update(['name' => $name, 'updated_at' => now()]);
        Audit::write($user->id, 'auth.profile_update', 'user', $user->id);

        return response()->json(['user' => UvhRequest::publicUser($user->refresh())]);
    }

    public function changePassword(Request $request)
    {
        $current = (string) $request->input('current', '');
        $newPassword = (string) $request->input('newPassword', '');

        if ($current === '' || strlen($current) > 128 || ! $this->validPassword($newPassword)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $user = UvhRequest::user($request);
        if (! Hash::check($current, $user->password_hash)) {
            return response()->json(['error' => 'Contraseña actual incorrecta'], 403);
        }

        DB::transaction(function () use ($user, $newPassword, $request) {
            $user->update(['password_hash' => Hash::make($newPassword), 'updated_at' => now()]);
            $sessionId = UvhRequest::sessionId($request);
            DB::table('sessions')->where('user_id', $user->id)->where('id', '!=', $sessionId)->update(['revoked_at' => now()]);
        });

        Audit::write($user->id, 'auth.password_change', 'user', $user->id);

        return response()->json(['ok' => true]);
    }

    public function sessions(Request $request)
    {
        $user = UvhRequest::user($request);
        $currentId = UvhRequest::sessionId($request);
        $rows = $user->sessions()->orderByDesc('last_used_at')->get()->map(fn ($s) => [
            'id' => $s->id,
            'user_agent' => $s->user_agent,
            'created_at' => $this->iso($s->created_at),
            'last_used_at' => $this->iso($s->last_used_at),
            'expires_at' => $this->iso($s->expires_at),
            'revoked_at' => $this->iso($s->revoked_at),
            'current' => $s->id === $currentId,
        ]);

        return response()->json(['sessions' => $rows]);
    }

    public function revokeSession(Request $request, string $id)
    {
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
        $password = (string) $request->input('password', '');
        $code = $request->input('code');

        if ($password === '' || strlen($password) > 128 || ($code !== null && ! is_string($code))) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $user = UvhRequest::user($request);
        if (! Hash::check($password, $user->password_hash)) {
            return response()->json(['error' => 'Contraseña incorrecta'], 403);
        }

        // Step-up: reconfiguring active MFA requires the current TOTP code.
        if ($user->mfa_enabled) {
            if (! is_string($code) || ! preg_match('/^\d{6}$/', $code)
                || ! $user->mfa_secret
                || ! Totp::verify($code, UvhCrypto::decryptAtRest($user->mfa_secret))) {
                return response()->json(['error' => 'Código TOTP actual requerido para reconfigurar MFA'], 403);
            }
        }

        $secret = Totp::generateSecret();
        $user->update(['mfa_secret' => UvhCrypto::encryptAtRest($secret)]);
        $uri = Totp::provisioningUri($user->email, 'UVH', $secret);

        Audit::write($user->id, 'auth.mfa_setup', 'user', $user->id);

        return response()->json(['secret' => $secret, 'uri' => $uri]);
    }

    public function mfaEnable(Request $request)
    {
        $code = (string) $request->input('code', '');
        if (! preg_match('/^\d{6}$/', $code)) {
            return response()->json(['error' => 'Código inválido'], 422);
        }

        $user = UvhRequest::user($request);
        if (! $user->mfa_secret || ! Totp::verify($code, UvhCrypto::decryptAtRest($user->mfa_secret))) {
            return response()->json(['error' => 'Código incorrecto'], 403);
        }

        $recoveryCodes = [];
        for ($i = 0; $i < 10; $i++) {
            $recoveryCodes[] = Ids::randomToken(10);
        }

        $user->update([
            'mfa_enabled' => true,
            'recovery_codes' => array_map(fn ($c) => Ids::sha256Hex($c), $recoveryCodes),
            'updated_at' => now(),
        ]);

        Audit::write($user->id, 'auth.mfa_enable', 'user', $user->id);

        return response()->json(['recoveryCodes' => $recoveryCodes]);
    }

    public function mfaDisable(Request $request)
    {
        $password = (string) $request->input('password', '');
        $code = (string) $request->input('code', '');

        if ($password === '' || strlen($password) > 128 || ! preg_match('/^\d{6}$/', $code)) {
            return response()->json(['error' => 'Contraseña y código TOTP requeridos'], 422);
        }

        $user = UvhRequest::user($request);
        if (! Hash::check($password, $user->password_hash)) {
            return response()->json(['error' => 'Contraseña incorrecta'], 403);
        }
        if (! $user->mfa_secret || ! Totp::verify($code, UvhCrypto::decryptAtRest($user->mfa_secret))) {
            return response()->json(['error' => 'Código TOTP incorrecto'], 403);
        }

        $user->update([
            'mfa_enabled' => false,
            'mfa_secret' => null,
            'recovery_codes' => null,
            'updated_at' => now(),
        ]);

        Audit::write($user->id, 'auth.mfa_disable', 'user', $user->id);

        return response()->json(['ok' => true]);
    }

    // ---------------- helpers ----------------

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
        return strlen($password) >= 10 && strlen($password) <= 128;
    }

    private function validName(string $name): bool
    {
        $len = mb_strlen($name);

        return $len >= 2 && $len <= 80 && ! preg_match('/[\x00-\x1f\x7f]/', $name);
    }

    private function appUrl(): string
    {
        return rtrim((string) config('app.url'), '/');
    }

    private function iso(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        return $value instanceof \DateTimeInterface
            ? $value->format('Y-m-d\TH:i:s.v\Z')
            : (string) $value;
    }

    private function mfaChallengeKey(string $challenge): string
    {
        return 'uvh:mfa:challenge:'.Ids::sha256Hex($challenge);
    }

    private function storeMfaChallenge(string $challenge, int $userId): void
    {
        Cache::put(
            $this->mfaChallengeKey($challenge),
            ['user_id' => $userId],
            now()->addSeconds(self::MFA_CHALLENGE_TTL),
        );
    }

    /** @return array{user_id: int}|null */
    private function getMfaChallenge(string $challenge): ?array
    {
        if ($challenge === '' || strlen($challenge) > 128) {
            return null;
        }
        $value = Cache::get($this->mfaChallengeKey($challenge));

        return is_array($value) && isset($value['user_id'])
            ? ['user_id' => (int) $value['user_id']]
            : null;
    }

    private function forgetMfaChallenge(string $challenge): void
    {
        Cache::forget($this->mfaChallengeKey($challenge));
    }

    private function mfaAttemptKey(int $userId): string
    {
        return 'uvh:mfa:attempts:'.$userId;
    }

    private function mfaTooManyAttempts(int $userId): bool
    {
        return RateLimiter::tooManyAttempts($this->mfaAttemptKey($userId), self::MFA_MAX_ATTEMPTS);
    }

    private function mfaRecordFailure(int $userId): void
    {
        RateLimiter::hit($this->mfaAttemptKey($userId), self::MFA_ATTEMPT_WINDOW);
    }

    private function clearMfaAttempts(int $userId): void
    {
        RateLimiter::clear($this->mfaAttemptKey($userId));
    }
}
