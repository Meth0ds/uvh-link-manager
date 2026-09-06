<?php

namespace App\Http\Controllers;

use App\Support\UvhRequest;
use App\Support\WorkspaceAccess;
use App\Support\WorkspaceLimits;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Aggregate-only usage. Never serialize quota rows, credentials or recipients. */
final class WorkspaceUsageController
{
    public function show(Request $request, int $id)
    {
        $user = UvhRequest::user($request);
        try {
            return DB::transaction(function () use ($user, $id) {
                DB::statement("SET LOCAL lock_timeout = '2s'");
                DB::statement("SET LOCAL statement_timeout = '5s'");
                $membership = WorkspaceAccess::getMembershipLocked($user->id, $id, 'viewer',
                    expectedSecurityVersion: (int) $user->security_version);
                if (! $membership) {
                    return response()->json(['error' => 'Sin acceso a este workspace'], 403);
                }

                $editor = WorkspaceAccess::roleAtLeast($membership->role, 'editor');
                $admin = WorkspaceAccess::roleAtLeast($membership->role, 'admin');
                $asOf = now();
                // One statement provides the same MVCC snapshot for every
                // count. Parent locks retain authorization; counts do NOT reserve
                // capacity or bypass the mutation's own checks and step-up.
                $query = DB::table('workspaces as w')->leftJoin('quotas as q', 'q.workspace_id', '=', 'w.id')
                    ->where('w.id', $id)->select(['q.links_limit'])
                    ->selectRaw('(SELECT COUNT(*) FROM links l WHERE l.workspace_id = w.id AND l.deleted_at IS NULL) AS links_used')
                    ->selectRaw('(SELECT COUNT(*) FROM custom_domains d WHERE d.workspace_id = w.id) AS domains_used')
                    ->selectRaw('(SELECT COUNT(*) FROM memberships m WHERE m.workspace_id = w.id) AS members_used')
                    ->selectRaw('(SELECT COUNT(*) FROM webhooks h WHERE h.workspace_id = w.id) AS webhooks_used');
                // Redact in SQL, not just in JSON: a viewer does not gain even
                // token counts, and invitation capacity is owner/admin only.
                if ($editor) {
                    $query->selectRaw('(SELECT COUNT(*) FROM api_tokens t WHERE t.workspace_id = w.id AND t.revoked_at IS NULL
                        AND (t.expires_at IS NULL OR t.expires_at > ?)) AS tokens_used', [$asOf]);
                }
                if ($admin) {
                    // Count exactly what invite/resend admission counts, including
                    // any legacy pending row; do not substitute onboarding facts.
                    $query->selectRaw("(SELECT COUNT(*) FROM invitations i WHERE i.workspace_id = w.id
                        AND i.status = 'pending' AND i.expires_at > ?) AS invitations_used", [$asOf]);
                }
                $row = $query->first();
                if (! $row) {
                    throw new \RuntimeException('Missing usage snapshot');
                }
                $linksLimit = $row->links_limit;
                // Missing/corrupt configuration is not an unlimited plan. Keep
                // it explicit without fabricating a default from registration.
                $validLinksLimit = $linksLimit !== null && (int) $linksLimit >= 0;

                return response()->json([
                    'workspaceId' => $id, 'role' => $membership->role, 'measuredAt' => $asOf->toIso8601String(),
                    'resources' => [
                        'links' => $this->quota((int) $row->links_used, $validLinksLimit ? (int) $linksLimit : null,
                            $validLinksLimit ? 'enforced' : 'unavailable', $editor),
                        'domains' => $this->quota((int) $row->domains_used, WorkspaceLimits::DOMAINS, 'enforced', $editor),
                        // There is no implemented member-cap policy. A null limit
                        // means no configured cap, not infinite service capacity.
                        'members' => $this->quota((int) $row->members_used, null, 'not_configured', $admin),
                        'tokens' => $editor ? $this->quota((int) $row->tokens_used, WorkspaceLimits::ACTIVE_TOKENS, 'enforced', true) : null,
                        'webhooks' => $this->quota((int) $row->webhooks_used, WorkspaceLimits::WEBHOOKS, 'enforced', $editor),
                        'invitations' => $admin ? $this->quota((int) $row->invitations_used, WorkspaceLimits::ACTIVE_INVITATIONS, 'enforced', true) : null,
                    ],
                    'analytics' => ['retentionDays' => WorkspaceLimits::analyticsRetentionDays(),
                        'maximumQueryRangeDays' => WorkspaceLimits::ANALYTICS_RANGE_DAYS,
                        'basis' => 'configured_policy', 'purgeVerified' => false],
                    'basis' => 'snapshot_not_reservation',
                ]);
            });
        } catch (\Throwable) {
            // No zero-filled fallback: a missing schema or timeout must never
            // look like an empty tenant with available capacity.
            return response()->json(['error' => 'No se pudo consultar el uso. Inténtalo más tarde.'], 503);
        }
    }

    private function quota(int $used, ?int $limit, string $policy, bool $canManage): array
    {
        return ['used' => $used, 'limit' => $limit, 'remaining' => $limit === null ? null : max(0, $limit - $used),
            'policy' => $policy, 'reached' => $limit === null ? null : $used >= $limit, 'canManage' => $canManage];
    }
}
