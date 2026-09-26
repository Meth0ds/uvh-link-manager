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
        $userAgent = self::persistableUserAgent($request->header('user-agent'));

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

    /**
     * Persisted-header policy (BAF-051): the user agent is attacker controlled
     * and the column is `varchar(255)`, so whatever arrives must leave here as
     * valid UTF-8 within the column's bound — or the INSERT fails with a 500
     * and this client cannot log in at all.
     *
     * Invalid byte sequences are scrubbed and control characters —including
     * NUL, which PostgreSQL refuses inside `text`— are dropped; what remains is
     * cut to 255 BYTES, which always fit `varchar(255)` because UTF-8 never
     * uses fewer bytes than characters, and `mb_strcut` stops on a character
     * boundary so the stored value stays well-formed. A header with nothing
     * persistable left stores no user agent at all instead of an empty string.
     */
    private static function persistableUserAgent(?string $userAgent): ?string
    {
        if ($userAgent === null) {
            return null;
        }
        $userAgent = preg_replace('/[\x00-\x1F\x7F]/', '', mb_scrub($userAgent, 'UTF-8')) ?? '';
        $userAgent = mb_strcut(trim($userAgent), 0, 255, 'UTF-8');

        return $userAgent === '' ? null : $userAgent;
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

        if (! $session) {
            return null;
        }

        // Hold the owner in a local: the relation is nullable on the model, and
        // reading it once keeps the guards below and the returned array
        // referring to the same, non-null instance.
        $user = $session->user;
        if (! $user || $session->expires_at->isPast()) {
            return null;
        }

        // Revocation alone is not sufficient for a request that started just
        // before a password/MFA change. Security versioning makes that stale
        // cookie unusable on its next request.
        if ((int) $session->security_version !== (int) $user->security_version) {
            self::revoke($session->id);

            return null;
        }

        // Sessions from before the verified-login policy are revoked on first
        // use. This closes the migration window for stale cookies without
        // preventing the public verification endpoint from working.
        if (! $user->email_verified_at) {
            self::revoke($session->id);

            return null;
        }

        // Throttle the last_used_at write to at most once a minute per session.
        if ($session->last_used_at === null || $session->last_used_at->isFuture() || $session->last_used_at->lt(now()->subMinute())) {
            $session->forceFill(['last_used_at' => now()])->save();
        }

        return [
            'user' => $user,
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
