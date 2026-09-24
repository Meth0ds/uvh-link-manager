<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Symfony\Component\HttpFoundation\Cookie;

/**
 * Server-side parking for the two handoff bearers the panel used to keep in
 * `localStorage`.
 *
 * An invitation link carries a bearer valid for seven days, and a link prepared
 * before signing in carries one valid for a day. Both were stored in
 * `localStorage`, which means any script that manages to run on the origin
 * reads them: a defensive CSP reduces how often that happens, it does not make
 * the storage private. Parking moves the bearer into an HttpOnly cookie the
 * server minted, so the page never holds it and the browser never shows it to
 * script.
 *
 * What the server asserts about the parked value, and what it refuses to
 * assume:
 *
 *  - **Shape, not existence.** `park()` accepts the shape this application
 *    issues and nothing else. Parking never asks whether the bearer exists,
 *    because a different answer for a real invitation and an invented one would
 *    turn a public endpoint into an oracle.
 *  - **The client may shorten, never extend.** `expiresAt` arrives from the page
 *    that holds the record, and a wrong or hostile value must not become a
 *    seven-day cookie. The deadline is the server's, the client's is a lower
 *    bound request.
 *  - **The signature covers the kind.** The payload carries which of the two
 *    handoffs it is, so copying the invitation cookie into the intent cookie
 *    name produces nothing usable rather than a cross-kind swap.
 *  - **Host-only, always.** No `Domain` attribute: a handoff parked on the
 *    origin that will consume it must not travel to sibling hosts, which is
 *    precisely the exposure that parking it server-side removes.
 */
final class PendingHandoff
{
    public const INVITATION = 'invitation';

    public const INTENT = 'link-intent';

    /** Identifies the payload shape, so a future change is explicit, not silent. */
    private const PAYLOAD_VERSION = 1;

    /**
     * Every handoff bearer this application issues is 32 random bytes in
     * unpadded base64url — `Ids::randomToken(32)`, used for invitations and for
     * link intents. Parking accepts exactly that and nothing else: it keeps the
     * cookie small, keeps an arbitrary attacker-supplied string from being
     * signed, and makes a rotation of the bearer length fail loudly in tests
     * instead of quietly refusing every freshly issued token.
     */
    private const BEARER_PATTERN = '/^[A-Za-z0-9_-]{43}$/D';

    /**
     * Both kinds, in the order the panel reports them.
     *
     * @return list<string>
     */
    public static function kinds(): array
    {
        return [self::INVITATION, self::INTENT];
    }

    public static function exists(string $kind): bool
    {
        return in_array($kind, self::kinds(), true);
    }

    /** The cookie a kind is parked under; it never shares a name with the other. */
    public static function cookieName(string $kind): string
    {
        return (string) config($kind === self::INVITATION ? 'uvh.invitation_cookie' : 'uvh.intent_cookie');
    }

    /**
     * How long the server is willing to park this kind.
     *
     * Never longer than the record the bearer points at: parking an expired
     * invitation in a live cookie only moves the failure to the next visit.
     */
    public static function ceilingSeconds(string $kind): int
    {
        return $kind === self::INVITATION
            ? max(60, (int) config('uvh.invitation_ttl_days') * 86400)
            : max(60, (int) config('uvh.intent_ttl_hours') * 3600);
    }

    /**
     * Whether a value has the shape of a handoff bearer.
     *
     * Public because the controllers that read a parked bearer and the endpoint
     * that stores one must agree on the same shape; a second pattern would be a
     * second definition of what the application issues.
     */
    public static function accepts(string $bearer): bool
    {
        return preg_match(self::BEARER_PATTERN, $bearer) === 1;
    }

    /**
     * Absolute expiry for the parked cookie, or null when the deadline the
     * client advertised has already passed.
     *
     * The client is trusted to shorten the deadline and never to extend it.
     * An unparsable value falls back to the server ceiling rather than being
     * rejected: the deadline is the server's decision either way, and refusing
     * to park because a page sent the wrong format would fail a flow whose
     * bearer is perfectly valid.
     */
    public static function deadline(string $kind, ?string $requested): ?int
    {
        $ceiling = now()->addSeconds(self::ceilingSeconds($kind))->getTimestamp();
        $requested = $requested === null ? '' : trim($requested);
        if ($requested === '') {
            return $ceiling;
        }

        $parsed = IsoDate::parse($requested);
        if ($parsed === null) {
            return $ceiling;
        }

        $timestamp = $parsed->getTimestamp();

        return $timestamp <= now()->getTimestamp() ? null : min($timestamp, $ceiling);
    }

    public static function cookie(string $kind, string $bearer, int $expiresAt): Cookie
    {
        $payload = json_encode([
            'v' => self::PAYLOAD_VERSION,
            'kind' => $kind,
            'bearer' => $bearer,
            'exp' => $expiresAt,
        ], JSON_UNESCAPED_SLASHES);

        return self::makeCookie(
            $kind,
            SignedToken::sign($payload === false ? '' : $payload, max(1000, ($expiresAt - time()) * 1000)),
            $expiresAt,
        );
    }

    public static function clearCookie(string $kind): Cookie
    {
        return self::makeCookie($kind, '', time() - 3600);
    }

    /**
     * Drop a parked handoff as part of a terminal outcome.
     *
     * Used when the bearer was consumed or is unusable for good. A handoff that
     * failed transiently is deliberately left parked, so a retry can still
     * succeed; a handoff that is spent must not keep inviting the browser back
     * to the same dead end.
     */
    public static function clearOn(JsonResponse $response, string $kind): JsonResponse
    {
        $response->headers->setCookie(self::clearCookie($kind));

        return $response;
    }

    /** The bearer this request's parked cookie carries, when the cookie is intact. */
    public static function bearer(Request $request, string $kind): ?string
    {
        $parked = self::read($request, $kind);

        return $parked['bearer'] ?? null;
    }

    /** Deadline of the parked cookie in ISO form, so the panel can show it. */
    public static function expiresAt(Request $request, string $kind): ?string
    {
        $parked = self::read($request, $kind);

        return $parked === null ? null : IsoDate::format(Carbon::createFromTimestamp($parked['expiresAt']));
    }

    public static function pending(Request $request, string $kind): bool
    {
        return self::read($request, $kind) !== null;
    }

    /**
     * Verify and decode a parked cookie. Every way of being wrong — absent,
     * empty, tampered, expired, another kind, another payload version — returns
     * the same null, which is what makes "not pending" indistinguishable from
     * "pending but forged".
     *
     * @return array{bearer: string, expiresAt: int}|null
     */
    private static function read(Request $request, string $kind): ?array
    {
        $value = $request->cookies->get(self::cookieName($kind));
        if (! is_string($value) || $value === '') {
            return null;
        }

        $parked = SignedToken::verify($value, function (string $payload) use ($kind): ?array {
            $decoded = json_decode($payload, true);
            if (! is_array($decoded)
                || ($decoded['v'] ?? null) !== self::PAYLOAD_VERSION
                || ($decoded['kind'] ?? null) !== $kind
                || ! is_string($decoded['bearer'] ?? null)
                || ! self::accepts($decoded['bearer'])
                || ! is_int($decoded['exp'] ?? null)
                || $decoded['exp'] <= time()) {
                return null;
            }

            return ['bearer' => $decoded['bearer'], 'expiresAt' => $decoded['exp']];
        });

        if (! is_array($parked) || ! is_string($parked['bearer'] ?? null) || ! is_int($parked['expiresAt'] ?? null)) {
            return null;
        }

        return ['bearer' => $parked['bearer'], 'expiresAt' => $parked['expiresAt']];
    }

    /**
     * The attributes live in `HostOnlyCookie`, which is the single owner of
     * "host-only, HttpOnly, Lax" for cookies that only serve the origin that
     * set them; see its docblock for why that policy is not the session one.
     */
    private static function makeCookie(string $kind, string $value, int $expires): Cookie
    {
        return HostOnlyCookie::make(self::cookieName($kind), $value, $expires);
    }
}
