<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        RateLimiter::for('uvh-auth', function (Request $request) {
            return Limit::perMinutes(15, (int) config('uvh.rate_limits.auth'))
                ->by($request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiados intentos. Espera unos minutos.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-register', function (Request $request) {
            return Limit::perMinutes(60, (int) config('uvh.rate_limits.register'))
                ->by($request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiados registros desde esta IP.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-link-create', function (Request $request) {
            return Limit::perMinute((int) config('uvh.rate_limits.link_create'))
                ->by($request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiados enlaces en poco tiempo.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-resolve', function (Request $request) {
            return Limit::perMinute((int) config('uvh.rate_limits.resolve'))
                ->by($request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiadas resoluciones de enlaces.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-report', function (Request $request) {
            return Limit::perMinute(10)
                ->by($request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiadas denuncias.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-api', function (Request $request) {
            return Limit::perMinute(120)
                ->by($request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Rate limit de API excedido.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-admin', function (Request $request) {
            return Limit::perMinute(60)
                ->by($request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Rate limit administrativo.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-api-token', function (Request $request) {
            $token = $request->attributes->get('uvh.api_token');
            $key = $token ? 'token:'.$token['token_id'] : 'ip:'.$request->ip();

            return Limit::perMinute((int) config('uvh.rate_limits.api_token'))
                ->by($key)
                ->response(fn ($request, $headers) => response()->json(['error' => 'Rate limit de API excedido para este token.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-unlock', function (Request $request) {
            $key = $request->ip().'|'.($request->route('alias') ?? '');

            return Limit::perMinute(10)
                ->by($key)
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiados intentos para este enlace.'], 429)->withHeaders($headers));
        });
    }
}
