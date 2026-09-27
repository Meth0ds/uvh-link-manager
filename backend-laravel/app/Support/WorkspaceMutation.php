<?php

namespace App\Support;

use App\Exceptions\LinkException;
use App\Models\Link;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class WorkspaceMutation
{
    /**
     * Recheck the middleware snapshot while holding account → workspace locks.
     *
     * @template T
     *
     * @param  callable(): T  $mutation
     * @return T
     */
    public static function run(Request $request, callable $mutation): mixed
    {
        return DB::transaction(function () use ($request, $mutation) {
            $user = UvhRequest::user($request);
            $workspaceId = UvhRequest::workspaceId($request);
            if (! $user || ! $workspaceId || ! WorkspaceAccess::getMembershipLocked(
                (int) $user->id, $workspaceId, 'editor', UvhRequest::apiToken($request),
                'links:write', (int) $user->security_version,
            )) {
                throw new LinkException('Tu acceso al workspace cambió. Recarga antes de continuar.', 403);
            }

            return $mutation();
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
