<?php

namespace App\Http\Middleware;

use App\Models\ApiToken;
use App\Support\Ids;
use App\Support\UvhRequest;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * uvh.apitoken:links:read  => require Bearer token with the given scopes.
 */
class RequireApiToken
{
    public const SCOPES = ['links:read', 'links:write', 'analytics:read', 'domains:read', 'domains:write'];

    public function handle(Request $request, Closure $next, string ...$required): Response
    {
        $header = $request->header('authorization', '');
        $token = str_starts_with($header, 'Bearer ') ? substr($header, 7) : null;

        if (! $token) {
            return response()->json(['error' => 'Token de API requerido'], 401);
        }

        if (strlen($token) > 256) {
            return response()->json(['error' => 'Token inválido o revocado'], 401);
        }

        $row = ApiToken::where('token_hash', Ids::sha256Hex($token))
            ->whereHas('creator', fn ($q) => $q->whereNull('deleted_at'))
            ->first();
        if (! $row || $row->revoked_at || ($row->expires_at && $row->expires_at->isPast())) {
            return response()->json(['error' => 'Token inválido o revocado'], 401);
        }

        $scopes = $row->scopes ?? [];
        foreach ($required as $r) {
            if (! in_array($r, $scopes, true)) {
                return response()->json(['error' => "Scope requerido: {$r}"], 403);
            }
        }

        $request->attributes->set(UvhRequest::API_TOKEN, [
            'workspace_id' => $row->workspace_id,
            'token_id' => $row->id,
            'scopes' => $scopes,
        ]);

        // Throttle last_used_at to at most once a minute per token.
        if ($row->last_used_at === null || now()->diffInSeconds($row->last_used_at) > 60) {
            $row->forceFill(['last_used_at' => now()])->save();
        }

        return $next($request);
    }
}
