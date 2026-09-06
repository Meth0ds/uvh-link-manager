<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class UvhHostGuard
{
    private const PUBLIC_API_PATHS = [
        '/api/v1/report',
        '/api/v1/status',
        '/api/v1/public-status',
        '/api/v1/create',
        '/api/v1/link-intents',
        '/api/v1/csrf',
        '/api/v1/config',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        if (config('app.env') !== 'production') {
            return $next($request);
        }

        $host = $this->normalizeHost($request->getHost());
        $path = $request->path() === '/' ? '/' : '/'.ltrim($request->path(), '/');

        if ($path === '/health') {
            return $next($request);
        }

        // Abuse reports use a dedicated hCaptcha sitekey bound to the public
        // origin. Keeping this mutation off APP_HOST prevents accidental use
        // of a token solved for a different origin and reduces the app host's
        // unauthenticated surface.
        if ($path === '/api/v1/report') {
            return $this->isPublicHost($host) ? $next($request) : response('', 404);
        }

        if (in_array($path, self::PUBLIC_API_PATHS, true)) {
            return $this->isPublicHost($host) || $this->isAppHost($host)
                ? $next($request)
                : response('', 404);
        }

        if ($this->isAppPath($path)) {
            return $this->isAppHost($host) ? $next($request) : response('', 404);
        }

        if ($this->isPublicPath($path)) {
            return $this->isPublicHost($host) ? $next($request) : response('', 404);
        }

        // Redirect surface: never on the app host.
        if ($this->isAppHost($host)) {
            return response('', 404);
        }

        return $next($request);
    }

    private function normalizeHost(string $host): string
    {
        return strtolower(preg_replace('/:\d+$/', '', $host) ?? $host);
    }

    private function isPublicHost(string $host): bool
    {
        $p = strtolower((string) config('uvh.public_host'));

        return $host === $p || $host === "www.{$p}";
    }

    private function isAppHost(string $host): bool
    {
        $a = strtolower((string) config('uvh.app_host'));

        return $host === $a || $host === "www.{$a}";
    }

    private function isAppPath(string $path): bool
    {
        return $path === '/api/v1'
            || str_starts_with($path, '/api/v1/')
            || $path === '/auth'
            || str_starts_with($path, '/auth/')
            || $path === '/app'
            || str_starts_with($path, '/app/')
            // These are Angular app routes too. Without them, production
            // invitation links and guard error pages are misclassified as the
            // public redirect surface and return a 404 on APP_HOST.
            || $path === '/invitations/accept'
            || str_starts_with($path, '/invitations/')
            || $path === '/forbidden'
            || $path === '/not-found';
    }

    private function isPublicPath(string $path): bool
    {
        return $path === '/'
            || $path === '/help'
            || $path === '/status'
            || $path === '/legal'
            || str_starts_with($path, '/legal/')
            || $path === '/robots.txt'
            || $path === '/sitemap.xml';
    }
}
