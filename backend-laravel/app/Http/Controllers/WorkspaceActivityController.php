<?php

namespace App\Http\Controllers;

use App\Support\UvhRequest;
use App\Support\WorkspaceAccess;
use App\Support\WorkspaceActivityCatalog;
use App\Support\WorkspaceActivityCursor;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

final class WorkspaceActivityController
{
    public function index(Request $request, int $id)
    {
        $user = UvhRequest::user($request);
        $limit = $request->query('limit', '25');
        $cursor = $request->query('cursor');
        if (! is_string($limit) || ! preg_match('/^[1-9][0-9]{0,2}$/D', $limit) || (int) $limit > 100
            || ($cursor !== null && (! is_string($cursor) || strlen($cursor) > 2048))) {
            return response()->json(['error' => 'Paginación inválida'], 422);
        }
        try {
            return DB::transaction(function () use ($id, $user, $cursor, $limit) {
                // Bound contention and expensive sparse-history scans. SET LOCAL
                // expires with this transaction and cannot leak to pooled callers.
                DB::statement("SET LOCAL lock_timeout = '2s'");
                DB::statement("SET LOCAL statement_timeout = '5s'");
                // Re-check authority under the same parent lock used by role
                // changes/removal. A cursor cannot preserve revoked permission.
                if (! WorkspaceAccess::getMembershipLocked($user->id, $id, 'admin', expectedSecurityVersion: (int) $user->security_version)) {
                    return response()->json(['error' => 'Sin acceso a la actividad de este workspace'], 403);
                }
                try {
                    $position = $cursor === null ? null : WorkspaceActivityCursor::read($cursor, $id, $user->id, (int) $user->security_version);
                } catch (\InvalidArgumentException) {
                    return response()->json(['error' => 'La paginación ha caducado o no es válida. Actualiza la actividad.'], 422);
                }
                $expiresAt = $position['expiresAt'] ?? now()->timestamp + WorkspaceActivityCursor::TTL;
                $query = DB::table('audit_events as a')
                    ->leftJoin('memberships as actor_membership', function ($join) {
                        $join->on('actor_membership.user_id', '=', 'a.user_id')->on('actor_membership.workspace_id', '=', 'a.workspace_id');
                    })
                    ->leftJoin('users as actor', 'actor.id', '=', 'actor_membership.user_id')
                    ->where('a.workspace_id', $id)
                    ->where(fn ($scope) => $scope->where('a.resource_type', '<>', 'workspace')->orWhere('a.resource_id', (string) $id))
                    ->where(function ($allowed) {
                        foreach (WorkspaceActivityCatalog::EVENTS as $action => [$type]) {
                            $allowed->orWhere(fn ($pair) => $pair->where('a.action', $action)->where('a.resource_type', $type));
                        }
                    })
                    ->select(['a.id', 'a.action', 'a.resource_type', 'a.resource_id', 'a.created_at'])
                    ->selectRaw('CASE WHEN actor.deleted_at IS NULL AND actor.email_verified_at IS NOT NULL THEN actor.id ELSE NULL END AS visible_actor_id')
                    // Select only a strict boolean interpretation, never metadata
                    // or even an unbounded string taken from inside metadata.
                    ->selectRaw("CASE WHEN a.action IN ('domain.verify', 'domain.revalidate') THEN
                        CASE WHEN a.metadata->'found' = 'true'::jsonb THEN 'completed'
                        WHEN a.metadata->'found' = 'false'::jsonb THEN 'failed' ELSE 'unknown' END
                        ELSE NULL END AS dns_outcome");
                if ($position !== null) {
                    $query->where(function ($before) use ($position) {
                        $before->where('a.created_at', '<', $position['createdAt'])
                            ->orWhere(fn ($tie) => $tie->where('a.created_at', '=', $position['createdAt'])->where('a.id', '<', $position['id']));
                    });
                }
                $rows = $query->orderByDesc('a.created_at')->orderByDesc('a.id')->limit((int) $limit + 1)->get();
                $hasMore = $rows->count() > (int) $limit;
                $page = $rows->take((int) $limit);
                $events = $page->map(function ($row) use ($user) {
                    [, $label, $outcome] = WorkspaceActivityCatalog::EVENTS[$row->action];
                    $moderation = str_starts_with($row->action, 'admin.');
                    $actorId = ! $moderation && $row->visible_actor_id !== null ? (string) $row->visible_actor_id : null;
                    // IDs are strings to avoid JS integer rounding. Names, emails,
                    // URLs and free-form moderation reasons are intentionally absent.
                    $resourceId = is_string($row->resource_id) && preg_match('/^[1-9][0-9]{0,18}$/D', $row->resource_id)
                        ? $row->resource_id : null;
                    return [
                        'id' => (string) $row->id, 'action' => $row->action, 'label' => $label,
                        'outcome' => $outcome === 'dns' ? $row->dns_outcome : $outcome,
                        'actor' => ['id' => $actorId, 'label' => $moderation ? 'Moderación'
                            : ($actorId === null ? 'Actor no disponible' : ($actorId === (string) $user->id ? 'Tú' : 'Miembro #'.$actorId))],
                        'resource' => ['type' => $row->resource_type, 'id' => $resourceId],
                        'createdAt' => Carbon::parse($row->created_at)->utc()->format('Y-m-d\TH:i:s.uP'),
                    ];
                })->values();
                $last = $page->last();
                $nextCursor = $hasMore && $last ? WorkspaceActivityCursor::issue($id, $user->id, (int) $user->security_version,
                    Carbon::parse($last->created_at)->utc()->format('Y-m-d\TH:i:s.uP'), (string) $last->id, $expiresAt) : null;
                return response()->json(['workspaceId' => $id, 'events' => $events, 'nextCursor' => $nextCursor,
                    'coverage' => 'attributed_events_only']);
            });
        } catch (\Throwable) {
            // Includes missing 000033 and infrastructure failures. No SQL or
            // cursor plaintext reaches the browser, and no fallback mixes tenants.
            return response()->json(['error' => 'No se pudo consultar la actividad. Inténtalo más tarde.'], 503);
        }
    }
}
