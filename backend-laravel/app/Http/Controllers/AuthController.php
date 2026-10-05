<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ValidatesAuthInput;
use App\Support\Audit;
use App\Support\Auth\AuthAccountLookup;
use App\Support\Auth\LoginAdmission;
use App\Support\Auth\RegistrationAttemptContext;
use App\Support\SessionManager;
use App\Support\UvhRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class AuthController
{
    use ValidatesAuthInput;

    // A valid cost-12 bcrypt hash for a value that is never accepted. Unknown
    // accounts still execute password verification, reducing timing-based
    // enumeration without constructing a fresh hash per request.
    private const DUMMY_PASSWORD_HASH = '$2y$12$P9Wl1lxLHGijwkSe6u4ive1jrgOvCs2K6cRjap1xfmi0GkoOLmqLO';

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

        $user = AuthAccountLookup::activeByEmail($email);
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

    public function logout(Request $request)
    {
        $sessionId = UvhRequest::sessionId($request);
        if ($sessionId) {
            SessionManager::revoke($sessionId);
            Audit::write(UvhRequest::user($request)?->id, 'auth.logout', 'session', $sessionId);
        }

        return response()->json(['ok' => true])->withCookie(SessionManager::clearCookie());
    }
}
