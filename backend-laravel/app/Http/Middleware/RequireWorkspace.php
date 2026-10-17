<?php

namespace App\Http\Middleware;

use App\Support\UvhRequest;
use App\Support\WorkspaceAccess;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * uvh.workspace           => membership (any role)
 * uvh.workspace:editor    => at least editor
 */
class RequireWorkspace
{
    public function handle(Request $request, Closure $next, string $min = 'viewer'): Response
    {
        $user = UvhRequest::user($request);
        if (! $user) {
            return response()->json(['error' => __('messages.error_bf623cf00a0e86')], 401);
        }

        $ws = WorkspaceAccess::resolve($user, $request);
        if (! $ws) {
            return response()->json(['error' => __('messages.error_d9a2380a9ab989')], 403);
        }
        if (! WorkspaceAccess::roleAtLeast($ws['role'], $min)) {
            return response()->json(['error' => __('messages.error_82d3cfd8e62d1d')], 403);
        }

        $request->attributes->set(UvhRequest::WORKSPACE_ID, $ws['workspace_id']);
        $request->attributes->set(UvhRequest::ROLE, $ws['role']);

        return $next($request);
    }
}
