<?php

namespace App\Http\Middleware;

use App\Support\UvhRequest;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireMfa
{
    public function handle(Request $request, Closure $next, string $level = 'verified'): Response
    {
        $user = UvhRequest::user($request);
        if (! $user || ! $user->mfa_enabled || ! UvhRequest::mfaVerified($request)) {
            return response()->json([
                'error' => 'Esta operación requiere una sesión autenticada con MFA',
                'details' => ['reason' => 'mfa_required'],
            ], 403);
        }

        if ($level === 'fresh') {
            $verifiedAt = UvhRequest::mfaVerifiedAt($request);
            $freshMinutes = max(1, min(60, (int) config('uvh.admin_mfa_fresh_minutes', 15)));
            if (! $verifiedAt || $verifiedAt < now()->subMinutes($freshMinutes)) {
                return response()->json([
                    'error' => 'Vuelve a confirmar tu identidad para acceder a administración',
                    'details' => ['reason' => 'mfa_reauthentication_required'],
                ], 403);
            }
        }

        return $next($request);
    }
}
