<?php

namespace App\Support;

use App\Exceptions\LinkException;
use App\Models\Link;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class WorkspaceMutation
{
    /**
     * Recheck authority under account → session (browser) → workspace locks.
     *
     * @template T
     *
     * @param  callable(): T  $mutation
     * @param  (callable(T): void)|null  $admitAudit
     * @return T
     */
    public static function run(Request $request, callable $mutation, ?callable $admitAudit = null): mixed
    {
        return DB::transaction(function () use ($request, $mutation, $admitAudit) {
            $user = UvhRequest::user($request);
            $workspaceId = UvhRequest::workspaceId($request);
            if (! $user || ! $workspaceId) {
                throw new LinkException('Tu acceso al workspace cambió. Recarga antes de continuar.', 403);
            }
            if (! WorkspaceWriteActor::fromRequest($request)->lockMembership((int) $user->id, $workspaceId, (int) $user->security_version)) {
                throw new LinkException('Tu acceso al workspace cambió. Recarga antes de continuar.', 403);
            }

            $result = $mutation();
            // The concrete event and its metadata belong to this commit too.
            // Admission failure rolls back the effect; history may recover later.
            if ($admitAudit !== null) {
                $admitAudit($result);
            }
            Audit::write((int) $user->id, 'workspace.mutation_committed', 'workspace', $workspaceId,
                ['route' => $request->route()?->uri()], workspaceId: $workspaceId);

            return $result;
        });
    }

    /** Advance the representation version, including changes through related resources. */
    public static function linkChanged(Link $link): void
    {
        $link->update(['version' => (int) $link->version + 1, 'updated_at' => now()]);
        WebhookService::dispatch((int) $link->workspace_id, 'link.updated', [
            'linkId' => (int) $link->id,
            'alias' => $link->alias,
        ]);
    }
}
