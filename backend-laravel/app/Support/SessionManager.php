<?php

namespace App\Support;

use App\Models\User;
use App\Models\UvhSession;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Cookie;

/**
 * Session manager: the cookie carries a raw token, the sessions row is keyed
 * by sha256(token), and only the hash is stored. Laravel's native session
 * stack is intentionally bypassed.
 */
class SessionManager
{
    public static function create(int $userId, Request $request, int $securityVersion, bool $mfaVerified = false): string
    {
        if ($securityVersion < 1) {
            throw new \InvalidArgumentException('Versión de seguridad inválida');
        }
        $token = Ids::randomToken(32);
        $expiresAt = now()->addDays((int) config('uvh.session_ttl_days'));
        $userAgent = $request->header('user-agent');
        if (is_string($userAgent)) {
            $userAgent = mb_strcut($userAgent, 0, 255, 'UTF-8');
        }

        UvhSession::create([
            'id' => Ids::sha256Hex($token),
            'user_id' => $userId,
            'user_agent' => $userAgent,
            'ip_hash' => $request->ip() ? UvhCrypto::hashIp($request->ip()) : null,
            'security_version' => $securityVersion,
            'mfa_verified_at' => $mfaVerified ? now() : null,
            'expires_at' => $expiresAt,
            'created_at' => now(),
            'last_used_at' => now(),
        ]);

        return $token;
    }

    public static function cookie(string $token): Cookie
    {
        return self::makeCookie($token, now()->addDays((int) config('uvh.session_ttl_days'))->getTimestamp());
    }

    public static function clearCookie(): Cookie
    {
        return self::makeCookie('', time() - 3600);
    }

    /**
     * Populate the request attributes from the session cookie. Never rejects.
     *
     * @return array{user: User, session_id: string, mfa_verified: bool, mfa_verified_at: ?\DateTimeInterface}|null
     */
    public static function hydrate(Request $request): ?array
    {
        $token = $request->cookies->get((string) config('uvh.session_cookie'));
        if (! is_string($token) || $token === '') {
            return null;
        }

        $session = UvhSession::with('user')
            ->where('id', Ids::sha256Hex($token))
            ->whereNull('revoked_at')
            // A blocked account must lose access even if a revoke operation
            // races with this request or an old session row survived it.
            ->whereHas('user', fn ($q) => $q->whereNull('deleted_at'))
            ->first();

        if (! $session || ! $session->user || $session->expires_at->isPast()) {
            return null;
        }

        // Revocation alone is not sufficient for a request that started just
        // before a password/MFA change. Security versioning makes that stale
        // cookie unusable on its next request.
        if ((int) $session->security_version !== (int) $session->user->security_version) {
            self::revoke($session->id);

            return null;
        }

        // Sessions from before the verified-login policy are revoked on first
        // use. This closes the migration window for stale cookies without
        // preventing the public verification endpoint from working.
        if (! $session->user->email_verified_at) {
            self::revoke($session->id);

            return null;
        }

        // Throttle the last_used_at write to at most once a minute per session.
        if ($session->last_used_at === null || $session->last_used_at->isFuture() || $session->last_used_at->lt(now()->subMinute())) {
            $session->forceFill(['last_used_at' => now()])->save();
        }

        return [
            'user' => $session->user,
            'session_id' => $session->id,
            'mfa_verified' => $session->mfa_verified_at !== null,
            'mfa_verified_at' => $session->mfa_verified_at,
        ];
    }

    public static function revoke(string $sessionId): void
    {
        UvhSession::where('id', $sessionId)->update(['revoked_at' => now()]);
    }

    private static function makeCookie(string $value, int $expires): Cookie
    {
        return new Cookie(
            (string) config('uvh.session_cookie'),
            $value,
            $expires,
            '/',
            (string) config('uvh.cookie_domain') !== '' ? (string) config('uvh.cookie_domain') : null,
            (bool) config('uvh.cookie_secure'),
            true,       // httpOnly
            false,      // raw
            'lax',
        );
    }
}
