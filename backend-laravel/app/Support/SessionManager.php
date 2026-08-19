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
    public static function create(int $userId, Request $request): string
    {
        $token = Ids::randomToken(32);
        $expiresAt = now()->addDays((int) config('uvh.session_ttl_days'));

        UvhSession::create([
            'id' => Ids::sha256Hex($token),
            'user_id' => $userId,
            'user_agent' => $request->header('user-agent'),
            'ip_hash' => $request->ip() ? UvhCrypto::hashIp($request->ip()) : null,
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
     * @return array{user: User, session_id: string}|null
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

        // Sessions from before the verified-login policy are revoked on first
        // use. This closes the migration window for stale cookies without
        // preventing the public verification endpoint from working.
        if (! $session->user->email_verified_at) {
            self::revoke($session->id);
            return null;
        }

        // Throttle the last_used_at write to at most once a minute per session.
        if ($session->last_used_at === null || now()->diffInSeconds($session->last_used_at) > 60) {
            $session->forceFill(['last_used_at' => now()])->save();
        }

        return ['user' => $session->user, 'session_id' => $session->id];
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
