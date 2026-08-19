<?php

namespace App\Http\Middleware;

use App\Support\UvhRequest;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireMfa
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = UvhRequest::user($request);
        if (! $user || ! $user->mfa_enabled) {
            return response()->json(['error' => 'El área de administración requiere MFA activado en tu cuenta'], 403);
        }

        return $next($request);
    }
}
