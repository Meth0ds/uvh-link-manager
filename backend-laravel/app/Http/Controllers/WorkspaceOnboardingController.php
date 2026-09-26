<?php

namespace App\Http\Controllers;

use App\Support\IsoDate;
use App\Support\UvhRequest;
use App\Support\WorkspaceAccess;
use Illuminate\Http\JsonResponse;
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
            ->select(['w.id', 'm.role', 'u.mfa_enabled', 'm.onboarding_dismissed_at'])
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
            // Estado de presentación propio de esta membresía: la guía cerrada
            // en un navegador sigue cerrada en los demás, y sólo el propio
            // usuario puede volver a abrirla.
            'dismissedAt' => IsoDate::format($row->onboarding_dismissed_at),
        ]);
    }

    /**
     * Oculta o reabre la guía para ESTE usuario en ESTE workspace. Sólo
     * persiste la preferencia de presentación: cerrar la guía no cambia hechos,
     * progreso ni nada que el servidor derive de los recursos.
     */
    public function dismiss(Request $request, int $id): JsonResponse
    {
        $user = UvhRequest::user($request);
        $hidden = $request->input('hidden');
        if (! is_bool($hidden)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $updated = DB::table('memberships')
            ->where('workspace_id', $id)->where('user_id', $user->id)
            ->update(['onboarding_dismissed_at' => $hidden ? now() : null]);
        if ($updated === 0) {
            // Same answer as `show`: no existence oracle for foreign ids.
            return response()->json(['error' => 'Sin acceso a este workspace'], 403);
        }

        return response()->json([
            'ok' => true,
            'dismissedAt' => $hidden ? IsoDate::format(now()) : null,
        ]);
    }
}
