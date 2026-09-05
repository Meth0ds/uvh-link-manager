<?php

use App\Http\Middleware\RequireApiToken;
use App\Http\Middleware\RequireMfa;
use App\Http\Middleware\RequireWorkspace;
use App\Http\Middleware\RecordOperationalResponse;
use App\Http\Middleware\SecurityHeaders;
use App\Http\Middleware\UvhAuth;
use App\Http\Middleware\UvhCsrf;
use App\Http\Middleware\UvhHostGuard;
use App\Http\Middleware\UvhSession;
use App\Support\MfaInfrastructureUnavailable;
use App\Support\OperationalMetrics;
use App\Support\WebhookAdmissionUnavailable;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\View\Middleware\ShareErrorsFromSession;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        // UVH exposes one explicit readiness endpoint below its own host,
        // security-header and rate-limit middleware. Avoid Laravel's second,
        // database-blind /up surface.
        health: null,
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Only explicitly configured reverse proxies may influence scheme,
        // client IP and Host-derived security decisions. Trusting all proxies
        // would let any direct client forge X-Forwarded-* headers.
        // The middleware builder runs before Laravel binds the configuration
        // repository, so this bootstrap-only value must come from the process
        // environment. AppServiceProvider validates the same value from the
        // cached configuration before any production worker starts serving.
        $trustedProxies = array_values(array_filter(array_map('trim', explode(',', (string) env('TRUSTED_PROXIES', '')))));
        if ($trustedProxies !== []) {
            $middleware->trustProxies(at: $trustedProxies);
        }

        $middleware->alias([
            'uvh.auth' => UvhAuth::class,
            'uvh.csrf' => UvhCsrf::class,
            'uvh.workspace' => RequireWorkspace::class,
            'uvh.apitoken' => RequireApiToken::class,
            'uvh.mfa' => RequireMfa::class,
        ]);

        // Global: security headers, session hydration, host separation.
        $middleware->append(RecordOperationalResponse::class);
        $middleware->append(SecurityHeaders::class);
        $middleware->append(UvhHostGuard::class);
        $middleware->append(UvhSession::class);

        // This app implements its own session + CSRF (parity with Express), so
        // Laravel's cookie/session/CSRF stack is bypassed on the web group.
        $middleware->web(remove: [
            EncryptCookies::class,
            AddQueuedCookiesToResponse::class,
            StartSession::class,
            ShareErrorsFromSession::class,
            PreventRequestForgery::class,
        ]);

        // Drop the default per-minute throttle: rate limits are applied per
        // route with Express-compatible named limiters.
        $middleware->api(remove: [
            ThrottleRequests::class.':api',
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->render(function (WebhookAdmissionUnavailable $exception, Request $request) {
            OperationalMetrics::increment('webhook.admission_failed');
            if ($request->is('api/*') || $request->expectsJson()) {
                return response()->json([
                    'error' => 'No se pudo registrar el evento de integración. No se ha aplicado el cambio; inténtalo de nuevo.',
                ], 503);
            }

            return response('El enlace no puede procesarse temporalmente. Inténtalo de nuevo en unos instantes.', 503, [
                'Content-Type' => 'text/plain; charset=utf-8',
                'Retry-After' => '30',
            ]);
        });
        $exceptions->render(function (MfaInfrastructureUnavailable $exception, Request $request) {
            OperationalMetrics::increment('mfa.infrastructure_unavailable');
            if ($request->is('api/*') || $request->expectsJson()) {
                return response()->json([
                    'error' => 'La verificación MFA no está disponible temporalmente. No se ha aplicado ningún cambio.',
                ], 503);
            }

            return null;
        });
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
