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
            return $level === 'optional' ? $next($request) : response()->json(['error' => __('messages.error_bf623cf00a0e86')], 401);
        }
        if ($error = $this->expectedAccountError($request, $user)) {
            return $error;
        }
        if ($level === 'verified' && ! $user->email_verified_at) {
            return response()->json(['error' => __('messages.error_6c955667ccf0c8')], 403);
        }
        if ($level === 'admin' && ! $user->is_admin) {
            return response()->json(['error' => __('messages.error_7c0d7d7d6042d9')], 403);
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
            return response()->json(['error' => __('messages.error_3a73b69b2cfb4f'), 'reason' => 'invalid_account_context'], 400);
        }
        if ($expected !== (string) $user->id) {
            // Do not revoke or replace the cookie: it may belong to a valid
            // newer login in another tab. Do not disclose either account ID.
            return response()->json([
                'error' => __('messages.error_ae258ba6e61fc0'),
                'reason' => 'session_context_changed',
            ], 409);
        }

        return null;
    }
}
