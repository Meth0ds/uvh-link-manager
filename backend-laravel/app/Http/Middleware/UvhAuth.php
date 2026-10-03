<?php

namespace App\Http\Middleware;

use App\Models\User;
use App\Support\UvhRequest;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * uvh.auth         => authenticated user
 * uvh.auth:verified=> authenticated + verified email
 * uvh.auth:admin   => authenticated + platform admin
 * uvh.auth:optional=> anonymous logout or a checked authenticated actor
 */
class UvhAuth
{
    public function handle(Request $request, Closure $next, string $level = 'auth'): Response
    {
        $user = UvhRequest::user($request);

        if (! $user) {
            return $level === 'optional' ? $next($request) : response()->json(['error' => 'No autenticado'], 401);
        }
        if ($error = $this->expectedAccountError($request, $user)) {
            return $error;
        }
        if ($level === 'verified' && ! $user->email_verified_at) {
            return response()->json(['error' => 'Verifica tu email para continuar'], 403);
        }
        if ($level === 'admin' && ! $user->is_admin) {
            return response()->json(['error' => 'Acceso restringido'], 403);
        }

        return $next($request);
    }

    /** A client expectation is a precondition, never a source of authority. */
    private function expectedAccountError(Request $request, User $user): ?JsonResponse
    {
        if (! $request->headers->has('X-Uvh-Account-Id')) {
            return null; // Preserve non-browser clients without a local projection.
        }
        $expected = $request->header('X-Uvh-Account-Id');
        if (! is_string($expected) || preg_match('/^[1-9][0-9]{0,18}$/D', $expected) !== 1) {
            return response()->json(['error' => 'Contexto de cuenta inválido', 'reason' => 'invalid_account_context'], 400);
        }
        if ($expected !== (string) $user->id) {
            // Do not revoke or replace the cookie: it may belong to a valid
            // newer login in another tab. Do not disclose either account ID.
            return response()->json([
                'error' => 'La sesión cambió. Vuelve a comprobar tu cuenta antes de continuar.',
                'reason' => 'session_context_changed',
            ], 409);
        }

        return null;
    }
}
