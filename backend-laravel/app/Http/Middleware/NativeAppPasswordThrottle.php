<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class NativeAppPasswordThrottle
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->isJson() || strlen($request->getContent()) > 8192) {
            return response()->json(['kind' => 'unavailable'], 422);
        }

        // Challenge negotiation and grant continuation are not guesses at a
        // password. Actual guesses share the browser's host/alias/IP budget and
        // security cache, without penalizing ordinary native openings.
        return $request->exists('password')
            ? app(UvhThrottleRequests::class)->handle($request, $next, 'uvh-unlock')
            : $next($request);
    }
}
