<?php

namespace App\Http\Middleware;

use App\Models\ApiToken;
use App\Models\Membership;
use App\Support\Ids;
use App\Support\UvhRequest;
use App\Support\WorkspaceAccess;
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
        // RFC 9110 §11.1 makes the auth scheme a case-insensitive token, so
        // `bearer`, `BEARER` and `Bearer` are the same header — and the same
        // header was already accepted elsewhere in this application, because
        // the metrics endpoint goes through Laravel's own `bearerToken()`,
        // which matches case-insensitively. Comparing the literal string here
        // meant the two disagreed: a client sending `bearer` was told its token
        // was missing, which is the one explanation that hides the real one.
        // Only the scheme is case-insensitive; the token is compared exactly.
        $header = trim((string) $request->header('authorization', ''));
        $token = preg_match('/^Bearer[ \t]+(\S+)$/i', $header, $matches) === 1 ? $matches[1] : null;

        if (! $token) {
            return response()->json(['error' => 'Token de API requerido'], 401);
        }

        if (strlen($token) > 256) {
            return response()->json(['error' => 'Token inválido o revocado'], 401);
        }

        $row = ApiToken::with('creator')->where('token_hash', Ids::sha256Hex($token))
            ->whereHas('creator', fn ($q) => $q->whereNull('deleted_at')->whereNotNull('email_verified_at'))
            ->first();
        if (! $row || ! $row->creator || $row->revoked_at || ($row->expires_at && $row->expires_at->isPast())) {
            return response()->json(['error' => 'Token inválido o revocado'], 401);
        }
        $membership = Membership::where('workspace_id', $row->workspace_id)->where('user_id', $row->created_by)->first();
        if (! $membership) {
            return response()->json(['error' => 'Token inválido o revocado'], 401);
        }

        $scopes = $row->scopes ?? [];
        if (! is_array($scopes) || array_diff($scopes, self::SCOPES) !== []) {
            return response()->json(['error' => 'Token inválido o revocado'], 401);
        }
        foreach ($required as $r) {
            if (! in_array($r, $scopes, true)) {
                return response()->json(['error' => "Scope requerido: {$r}"], 403);
            }
            // Scopes are a ceiling selected when the token is issued, not a
            // permanent grant that survives a later role reduction. Always
            // intersect them with the creator's current workspace authority.
            $minimumRole = str_ends_with($r, ':write') ? 'editor' : 'viewer';
            if (! WorkspaceAccess::roleAtLeast((string) $membership->role, $minimumRole)) {
                return response()->json(['error' => 'El rol actual del creador ya no permite esta operación'], 403);
            }
        }

        $request->attributes->set(UvhRequest::API_TOKEN, [
            'workspace_id' => $row->workspace_id,
            'token_id' => $row->id,
            'scopes' => $scopes,
        ]);
        // Bearer routes reuse the same tenant-aware controllers as the panel.
        // Populate their trusted request context from the token record rather
        // than from caller-controlled headers or an optional browser cookie.
        $request->attributes->set(UvhRequest::USER, $row->creator);
        $request->attributes->set(UvhRequest::WORKSPACE_ID, (int) $row->workspace_id);
        $request->attributes->set(UvhRequest::ROLE, (string) $membership->role);

        // Throttle last_used_at to at most once a minute per token.
        if ($row->last_used_at === null || $row->last_used_at->isFuture() || $row->last_used_at->lt(now()->subMinute())) {
            $row->forceFill(['last_used_at' => now()])->save();
        }

        return $next($request);
    }
}
