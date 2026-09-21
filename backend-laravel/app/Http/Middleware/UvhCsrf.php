<?php

namespace App\Http\Middleware;

use App\Support\Ids;
use App\Support\UvhRequest;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpFoundation\Response;

/**
 * Double-submit CSRF for the API surface. Intentionally NOT global: the
 * redirect hot path must not issue cookies for anonymous visitors.
 */
class UvhCsrf
{
    private const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

    public function handle(Request $request, Closure $next): Response
    {
        $token = $this->issue($request);

        if (! $this->verify($request)) {
            // `reason` is a machine-readable discriminator: a client cannot tell
            // this rejection from an authorization 403 by status alone, and only
            // this one may be answered by fetching a fresh token and repeating
            // the mutation once.
            return response()->json(['error' => 'Token CSRF inválido', 'reason' => 'csrf_rejected'], 403);
        }

        $response = $next($request);

        if ($request->attributes->get(UvhRequest::CSRF_ISSUED) === true) {
            // Use the deployment cookie policy rather than the request scheme:
            // TLS is commonly terminated at a reverse proxy, where Laravel may
            // otherwise see an HTTP hop and emit a non-Secure CSRF cookie.
            $response->headers->setCookie($this->cookie($token, (bool) config('uvh.cookie_secure')));
        }

        return $response;
    }

    private function issue(Request $request): string
    {
        // The bootstrap endpoint always mints a new token, and only it does.
        // Otherwise a client that believes its token is stale has no way to
        // replace it: reusing the cookie would hand back the same value, and a
        // browser will not let script delete a `__Host-` cookie (nor write
        // `Secure` from a plain HTTP origin), so deletion is not a rotation
        // mechanism. Every other route keeps reusing the cookie it was sent.
        $existing = $request->is('api/v1/csrf')
            ? null
            : $request->cookies->get((string) config('uvh.csrf_cookie'));
        if (is_string($existing) && $existing !== '') {
            $request->attributes->set(UvhRequest::CSRF_TOKEN, $existing);

            return $existing;
        }

        $token = Ids::base64urlEncode(random_bytes(24));
        $request->attributes->set(UvhRequest::CSRF_TOKEN, $token);
        $request->attributes->set(UvhRequest::CSRF_ISSUED, true);

        return $token;
    }

    private function verify(Request $request): bool
    {
        if (in_array($request->method(), self::SAFE_METHODS, true)) {
            return true;
        }
        $cookie = $request->cookies->get((string) config('uvh.csrf_cookie'));
        $supplied = $request->header('x-csrf-token') ?? $request->input('_csrf');

        return is_string($cookie) && is_string($supplied)
            && $cookie !== '' && hash_equals($cookie, $supplied);
    }

    private function cookie(string $token, bool $secure): Cookie
    {
        return new Cookie(
            (string) config('uvh.csrf_cookie'),
            $token,
            0,
            '/',
            null,
            $secure,
            false,  // httpOnly = false (frontend reads it)
            false,
            'lax',
        );
    }
}
