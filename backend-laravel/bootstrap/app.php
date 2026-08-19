<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'uvh.auth' => \App\Http\Middleware\UvhAuth::class,
            'uvh.csrf' => \App\Http\Middleware\UvhCsrf::class,
            'uvh.workspace' => \App\Http\Middleware\RequireWorkspace::class,
            'uvh.apitoken' => \App\Http\Middleware\RequireApiToken::class,
            'uvh.mfa' => \App\Http\Middleware\RequireMfa::class,
        ]);

        // Global: security headers, session hydration, host separation.
        $middleware->append(\App\Http\Middleware\SecurityHeaders::class);
        $middleware->append(\App\Http\Middleware\UvhHostGuard::class);
        $middleware->append(\App\Http\Middleware\UvhSession::class);

        // This app implements its own session + CSRF (parity with Express), so
        // Laravel's cookie/session/CSRF stack is bypassed on the web group.
        $middleware->web(remove: [
            \Illuminate\Cookie\Middleware\EncryptCookies::class,
            \Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse::class,
            \Illuminate\Session\Middleware\StartSession::class,
            \Illuminate\View\Middleware\ShareErrorsFromSession::class,
            \Illuminate\Foundation\Http\Middleware\PreventRequestForgery::class,
        ]);

        // Drop the default per-minute throttle: rate limits are applied per
        // route with Express-compatible named limiters.
        $middleware->api(remove: [
            \Illuminate\Routing\Middleware\ThrottleRequests::class.':api',
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
