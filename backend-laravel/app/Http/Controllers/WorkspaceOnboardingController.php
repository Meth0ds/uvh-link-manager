<?php

namespace App\Http\Controllers;

use App\Support\UvhRequest;
use App\Support\WorkspaceAccess;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Derived facts for onboarding; no duplicate progress ledger or test traffic. */
final class WorkspaceOnboardingController
{
    public function show(Request $request, int $id)
    {
        $user = UvhRequest::user($request);
        // One PostgreSQL statement gives authorization and all facts the same
        // snapshot. Every subquery correlates to the authorized workspace row;
        // X-Workspace-Id cannot redirect a fact query to another tenant.
        $row = DB::table('workspaces as w')
            ->join('memberships as m', 'm.workspace_id', '=', 'w.id')
            ->join('users as u', 'u.id', '=', 'm.user_id')
            ->where('w.id', $id)->where('u.id', $user->id)
            ->whereNull('u.deleted_at')->whereNotNull('u.email_verified_at')
            ->where('u.security_version', (int) $user->security_version)
            ->whereIn('m.role', WorkspaceAccess::ROLE_ORDER)
            ->select(['w.id', 'm.role', 'u.mfa_enabled'])
            ->selectRaw("CASE WHEN EXISTS (
                SELECT 1 FROM links l WHERE l.workspace_id = w.id AND l.deleted_at IS NULL AND l.state <> 'deleted'
            ) THEN 1 ELSE 0 END AS link_present")
            ->selectRaw("CASE WHEN EXISTS (
                SELECT 1 FROM links l WHERE l.workspace_id = w.id AND l.deleted_at IS NULL
                  AND l.state <> 'deleted' AND l.click_count > 0
            ) THEN 1 ELSE 0 END AS redirect_observed")
            ->selectRaw('CASE WHEN EXISTS (
                SELECT 1 FROM custom_domains d WHERE d.workspace_id = w.id
            ) THEN 1 ELSE 0 END AS domain_present')
            ->selectRaw('CASE WHEN EXISTS (
                SELECT 1 FROM memberships teammate JOIN users person ON person.id = teammate.user_id
                WHERE teammate.workspace_id = w.id AND teammate.user_id <> u.id
                  AND person.deleted_at IS NULL AND person.email_verified_at IS NOT NULL
            ) THEN 1 ELSE 0 END AS teammate_present')
            ->selectRaw("CASE WHEN m.role IN ('owner', 'admin') THEN CASE WHEN EXISTS (
                SELECT 1 FROM invitations i
                JOIN users sender ON sender.id = i.invited_by
                JOIN memberships authority ON authority.user_id = i.invited_by AND authority.workspace_id = i.workspace_id
                WHERE i.workspace_id = w.id AND i.status = 'pending' AND i.expires_at > CURRENT_TIMESTAMP
                  AND sender.deleted_at IS NULL AND sender.email_verified_at IS NOT NULL
                  AND ((i.role = 'admin' AND authority.role = 'owner')
                    OR (i.role IN ('editor', 'viewer') AND authority.role IN ('owner', 'admin')))
            ) THEN 1 ELSE 0 END ELSE NULL END AS invitation_pending")
            ->first();

        if (! $row) {
            // Match missing, revoked and foreign workspace responses without
            // leaking existence, names, invitation recipients or MFA secrets.
            return response()->json(['error' => 'Sin acceso a este workspace'], 403);
        }

        return response()->json([
            'workspaceId' => (int) $row->id,
            'role' => $row->role,
            'facts' => [
                'linkPresent' => (bool) $row->link_present,
                // click_count records an admitted redirect, not proof that the
                // browser reached the intended site. Do not label this E2E verified.
                'redirectObserved' => (bool) $row->redirect_observed,
                'domainPresent' => (bool) $row->domain_present,
                'teammatePresent' => (bool) $row->teammate_present,
                'invitationPending' => $row->invitation_pending === null ? null : (bool) $row->invitation_pending,
                'mfaEnabled' => (bool) $row->mfa_enabled,
            ],
            'capabilities' => [
                'createLink' => WorkspaceAccess::roleAtLeast($row->role, 'editor'),
                'addDomain' => WorkspaceAccess::roleAtLeast($row->role, 'editor'),
                'inviteTeam' => WorkspaceAccess::roleAtLeast($row->role, 'admin'),
            ],
        ]);
    }
}
