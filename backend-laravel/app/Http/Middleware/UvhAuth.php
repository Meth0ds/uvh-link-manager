<?php

namespace App\Http\Middleware;

use App\Support\UvhRequest;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * uvh.auth         => authenticated user
 * uvh.auth:verified=> authenticated + verified email
 * uvh.auth:admin   => authenticated + platform admin
 */
class UvhAuth
{
    public function handle(Request $request, Closure $next, string $level = 'auth'): Response
    {
        $user = UvhRequest::user($request);

        if (! $user) {
            return response()->json(['error' => 'No autenticado'], 401);
        }
        if ($level === 'verified' && ! $user->email_verified_at) {
            return response()->json(['error' => 'Verifica tu email para continuar'], 403);
        }
        if ($level === 'admin' && ! $user->is_admin) {
            return response()->json(['error' => 'Acceso restringido'], 403);
        }

        return $next($request);
    }
}
