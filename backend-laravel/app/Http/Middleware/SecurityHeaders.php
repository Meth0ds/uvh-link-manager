<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        // Laravel only serves dynamic responses in production. Prevent auth,
        // workspace data and mutable redirects from being retained by a
        // browser, service worker or intermediary cache.
        $response->headers->set('Cache-Control', 'no-store, private, max-age=0');
        $response->headers->set('Pragma', 'no-cache');
        $response->headers->set('Expires', '0');
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'DENY');
        $response->headers->set('Referrer-Policy', 'no-referrer');
        $response->headers->set('Cross-Origin-Opener-Policy', 'same-origin');
        $response->headers->set('Cross-Origin-Resource-Policy', 'same-origin');
        $response->headers->set('Origin-Agent-Cluster', '?1');
        $response->headers->set('X-Permitted-Cross-Domain-Policies', 'none');
        $response->headers->set(
            'Permissions-Policy',
            'accelerometer=(), autoplay=(), browsing-topics=(), camera=(), clipboard-read=(), clipboard-write=(self), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), usb=()',
        );
        $response->headers->set(
            'Content-Security-Policy',
            implode('; ', [
                "default-src 'self'",
                "script-src 'self'",
                "style-src 'self' 'unsafe-inline'",
                "font-src 'self'",
                "img-src 'self' data: blob:",
                "connect-src 'self'",
                "media-src 'none'",
                "object-src 'none'",
                "frame-src 'none'",
                "worker-src 'self'",
                "manifest-src 'self'",
                "frame-ancestors 'none'",
                "base-uri 'self'",
                "form-action 'self'",
                "require-trusted-types-for 'script'",
                'trusted-types angular angular#bundler',
            ]),
        );

        $host = strtolower(rtrim($request->getHost(), '.'));
        $publicHost = strtolower(rtrim((string) config('uvh.public_host'), '.'));
        $appHost = strtolower(rtrim((string) config('uvh.app_host'), '.'));
        $firstPartyHost = in_array($host, [$publicHost, 'www.'.$publicHost, $appHost, 'www.'.$appHost], true);
        if (config('uvh.hsts_enabled') && $request->isSecure() && $firstPartyHost) {
            $response->headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        return $response;
    }
}
