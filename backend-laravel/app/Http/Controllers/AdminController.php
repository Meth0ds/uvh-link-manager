<?php

namespace App\Http\Controllers;

use App\Models\AccountRecoveryRequest;
use App\Models\User;
use App\Support\AccountRecoveryLifecycle;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\LinkIntentRegistry;
use App\Support\MailAdmissionException;
use App\Support\MailDeliveryEligibility;
use App\Support\MailOutboxDispatcher;
use App\Support\MailTransportPolicy;
use App\Support\OperationalMetrics;
use App\Support\PrivateArtifactCleanup;
use App\Support\ProductionSecurity;
use App\Support\UvhMail;
use App\Support\UvhRequest;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class AdminController
{
    private const MAIL_MANUAL_RETRY_MAX_AGE_HOURS = 168;

    public function overview()
    {
        return response()->json([
            'users' => DB::table('users')->whereNull('deleted_at')->count(),
            'workspaces' => DB::table('workspaces')->count(),
            'links' => DB::table('links')->whereNull('deleted_at')->count(),
            'clicks' => DB::table('click_events')->count(),
            'openReports' => DB::table('abuse_reports')->where('status', 'open')->count(),
            'blockedLinks' => DB::table('links')->where('state', 'blocked')->count(),
            'domains' => DB::table('custom_domains')->count(),
        ]);
    }

    public function users(Request $request)
    {
        [$page, $perPage] = $this->pagination($request);
        $search = $this->search($request);
        $status = UvhRequest::queryString($request, 'status');
        if (! in_array($status, ['', 'active', 'blocked', 'unverified', 'admin', 'mfa'], true)) {
            return response()->json(['error' => 'Filtro de usuario inválido'], 422);
        }

        $query = DB::table('users as u')
            ->selectRaw('u.id, u.email, u.name, u.is_admin, u.email_verified_at, u.mfa_enabled, u.created_at, u.deleted_at,
                (SELECT COUNT(*) FROM memberships m WHERE m.user_id = u.id) AS workspaces,
                (SELECT COUNT(*) FROM links l WHERE l.created_by = u.id AND l.deleted_at IS NULL) AS links');

        if ($search !== '') {
            $like = "%{$search}%";
            $query->where(fn ($q) => $q->where('u.email', 'ilike', $like)->orWhere('u.name', 'ilike', $like));
        }

        match ($status) {
            'active' => $query->whereNull('u.deleted_at'),
            'blocked' => $query->whereNotNull('u.deleted_at'),
            'unverified' => $query->whereNull('u.deleted_at')->whereNull('u.email_verified_at'),
            'admin' => $query->whereNull('u.deleted_at')->where('u.is_admin', true),
            'mfa' => $query->whereNull('u.deleted_at')->where('u.mfa_enabled', true),
            default => null,
        };

        $total = (clone $query)->count();
        $rows = $query->orderByDesc('u.created_at')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get();

        return response()->json([
            'users' => $rows,
            'total' => $total,
            'page' => $page,
            'perPage' => $perPage,
        ]);
    }

    public function updateUser(Request $request, int $id)
    {
        $hasAdmin = $request->has('isAdmin');
        $hasBlocked = $request->has('blocked');
        $isAdmin = $request->input('isAdmin');
        $blocked = $request->input('blocked');
        if ((! $hasAdmin && ! $hasBlocked)
            || ($hasAdmin && ! is_bool($isAdmin))
            || ($hasBlocked && ! is_bool($blocked))) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $actorId = UvhRequest::user($request)->id;
        $sessionId = UvhRequest::sessionId($request);
        $ip = UvhRequest::ip($request);
        $result = DB::transaction(function () use ($id, $hasAdmin, $hasBlocked, $isAdmin, $blocked, $actorId, $sessionId, $ip): array {
            // Serialize changes that affect the platform-admin set, then lock
            // every involved user in primary-key order. This preserves the
            // last-admin invariant without the target/admin lock inversion
            // that could deadlock against account-recovery decisions.
            DB::select('SELECT pg_advisory_xact_lock(?, ?)', [0x555648, 2]);
            $adminIds = DB::table('users')->where('is_admin', true)->whereNull('deleted_at')
                ->orderBy('id')->pluck('id')->map(fn ($value) => (int) $value)->all();
            $lockIds = array_values(array_unique([$id, $actorId, ...$adminIds]));
            sort($lockIds, SORT_NUMERIC);
            $lockedUsers = DB::table('users')->whereIn('id', $lockIds)->orderBy('id')
                ->lockForUpdate()->get()->keyBy('id');
            $user = $lockedUsers->get($id);
            $lockedActor = $lockedUsers->get($actorId);
            if (! $this->eligibleLockedAdminSession($lockedActor, $sessionId)) {
                return ['status' => 'actor_changed'];
            }
            if (! $user) {
                return ['status' => 'not_found'];
            }
            $deletionRequest = DB::table('account_deletion_requests')->where('user_id', $id)
                ->lockForUpdate()->first();
            $activeAdmins = $lockedUsers->filter(fn ($candidate) => (bool) $candidate->is_admin && $candidate->deleted_at === null);

            $effectiveBlocked = $hasBlocked ? $blocked : $user->deleted_at !== null;
            if ($hasAdmin && $isAdmin === true
                && ($effectiveBlocked || $user->email_verified_at === null || ! (bool) $user->mfa_enabled)) {
                return ['status' => 'admin_ineligible'];
            }
            if ($hasBlocked && $blocked === false && (bool) $user->is_admin
                && ($user->email_verified_at === null || ! (bool) $user->mfa_enabled)) {
                return ['status' => 'admin_ineligible'];
            }
            if ($hasBlocked && $blocked === false && $deletionRequest?->status === 'scheduled') {
                return ['status' => 'deletion_scheduled'];
            }
            if ($hasBlocked && $blocked === false && $deletionRequest?->status === 'executed') {
                return ['status' => 'deletion_executed'];
            }

            $removesLastAdmin = (bool) $user->is_admin && ! $user->deleted_at
                && (($hasAdmin && $isAdmin === false) || ($hasBlocked && $blocked === true));
            if ($removesLastAdmin) {
                if ($activeAdmins->count() <= 1) {
                    return ['status' => 'last_admin'];
                }
            }

            $now = now();
            $wasBlocked = $user->deleted_at !== null;
            $blockTransition = $hasBlocked && $blocked === true && ! $wasBlocked;
            $unblockTransition = $hasBlocked && $blocked === false && $wasBlocked;
            $roleTransition = $hasAdmin && (bool) $user->is_admin !== $isAdmin;
            $changes = [];
            if ($roleTransition) {
                $changes['is_admin'] = $isAdmin;
            }
            if ($blockTransition || $unblockTransition) {
                $changes['deleted_at'] = $blocked ? $now : null;
                if ($blockTransition) {
                    $changes['security_version'] = (int) $user->security_version + 1;
                }
            }
            if ($changes !== []) {
                $changes['updated_at'] = $now;
                DB::table('users')->where('id', $id)->update($changes);
            }

            $artifacts = [];
            if ($blockTransition) {
                DB::table('sessions')->where('user_id', $id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
                DB::table('api_tokens')->where('created_by', $id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
                DB::table('email_tokens')->where('user_id', $id)->whereNull('used_at')->update(['used_at' => $now]);
                DB::table('invitations')->where('invited_by', $id)->where('status', 'pending')->update(['status' => 'cancelled']);
                DB::table('invitations')->whereRaw('lower(email) = ?', [strtolower((string) $user->email)])
                    ->where('status', 'pending')->update(['status' => 'cancelled']);
                DB::table('email_change_requests')->where('user_id', $id)->delete();
                AccountRecoveryLifecycle::cancelActiveForUser($id, $now);

                $artifacts = DB::table('data_export_requests')->where('user_id', $id)
                    ->whereIn('status', ['requested', 'processing', 'ready'])
                    ->whereNotNull('artifact_path')->get(['id', 'artifact_path'])
                    ->filter(fn ($export) => is_string($export->artifact_path) && $export->artifact_path !== '')
                    ->map(fn ($export) => ['id' => (int) $export->id, 'path' => $export->artifact_path])
                    ->values()->all();
                DB::table('data_export_requests')->where('user_id', $id)
                    ->whereIn('status', ['requested', 'processing', 'ready'])
                    ->update([
                        'status' => 'cancelled',
                        'confirmation_token_hash' => null,
                        'download_token_hash' => null,
                        'updated_at' => $now,
                    ]);

                if ($deletionRequest?->status === 'requested') {
                    DB::table('account_deletion_requests')->where('id', $deletionRequest->id)->update([
                        'status' => 'blocked',
                        'confirmation_token_hash' => null,
                        'updated_at' => $now,
                    ]);
                }
            }

            if ($roleTransition) {
                Audit::write($actorId, 'admin.user_role', 'user', $id, ['isAdmin' => $isAdmin], $ip);
            }
            if ($blockTransition || $unblockTransition) {
                Audit::write($actorId, 'admin.user_block', 'user', $id, ['blocked' => $blocked], $ip);
            }

            return [
                'status' => 'ok',
                'artifacts' => $artifacts,
                'revoke_intents' => $blockTransition,
            ];
        });
        if ($result['status'] === 'not_found') {
            return response()->json(['error' => 'Usuario no encontrado'], 404);
        }
        if ($result['status'] === 'actor_changed') {
            return response()->json(['error' => 'Tu rol, cuenta o MFA cambió. Vuelve a autenticarte'], 409);
        }
        if ($result['status'] === 'last_admin') {
            return response()->json(['error' => 'Debe quedar al menos un administrador activo'], 403);
        }
        if ($result['status'] === 'admin_ineligible') {
            return response()->json(['error' => 'Una cuenta administradora debe estar activa, verificada y tener MFA habilitado'], 409);
        }
        if ($result['status'] === 'deletion_scheduled') {
            return response()->json(['error' => 'La cuenta tiene una eliminación programada. Debe cancelarse con su enlace de seguridad antes de reactivarla'], 409);
        }
        if ($result['status'] === 'deletion_executed') {
            return response()->json(['error' => 'La cuenta ya fue anonimizada y no puede reactivarse desde administración'], 409);
        }

        foreach ($result['artifacts'] as $artifact) {
            PrivateArtifactCleanup::attempt($artifact['id'], $artifact['path']);
        }
        if ($result['revoke_intents']) {
            try {
                $intentRevocation = LinkIntentRegistry::revokeForUser($id);
            } catch (\Throwable) {
                $intentRevocation = ['revoked' => 0, 'busy' => -1];
            }
            Audit::write($actorId, 'admin.user_intents_revoked', 'user', $id, $intentRevocation, $ip);
        }

        return response()->json(['ok' => true]);
    }

    public function reports(Request $request)
    {
        [$page, $perPage] = $this->pagination($request);
        $search = $this->search($request);
        $status = UvhRequest::queryString($request, 'status');
        if (! in_array($status, ['', 'open', 'reviewed', 'actioned', 'dismissed'], true)) {
            return response()->json(['error' => 'Filtro de denuncia inválido'], 422);
        }

        $query = DB::table('abuse_reports as r')
            ->join('links as l', 'l.id', '=', 'r.link_id')
            ->select(
                'r.id',
                'r.link_id',
                'r.reporter_email',
                'r.reason',
                'r.details',
                'r.status',
                'r.created_at',
                'l.alias',
                'l.destination',
                'l.state as link_state',
                'l.workspace_id',
            );
        if ($status !== '') {
            $query->where('r.status', $status);
        }
        if ($search !== '') {
            $like = "%{$search}%";
            $query->where(function ($q) use ($like) {
                $q->where('l.alias', 'ilike', $like)
                    ->orWhere('r.reason', 'ilike', $like)
                    ->orWhere('r.reporter_email', 'ilike', $like);
            });
        }

        $total = (clone $query)->count();
        $rows = $query->orderByDesc('r.created_at')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get();

        return response()->json([
            'reports' => $rows,
            'total' => $total,
            'page' => $page,
            'perPage' => $perPage,
        ]);
    }

    public function updateReport(Request $request, int $id)
    {
        $status = UvhRequest::inputString($request, 'status');
        if (! in_array($status, ['open', 'reviewed', 'actioned', 'dismissed'], true)) {
            return response()->json(['error' => 'Estado inválido'], 422);
        }

        $actorId = UvhRequest::user($request)->id;
        $sessionId = UvhRequest::sessionId($request);
        $ip = UvhRequest::ip($request);
        $updated = DB::transaction(function () use ($id, $status, $actorId, $sessionId, $ip): string {
            if (! $this->lockEligibleAdmin($actorId, $sessionId)) {
                return 'actor_changed';
            }
            $row = DB::table('abuse_reports')->where('id', $id)->lockForUpdate()->first();
            if (! $row) {
                return 'not_found';
            }

            if ($row->status !== $status) {
                DB::table('abuse_reports')->where('id', $id)->update(['status' => $status]);
                Audit::write($actorId, 'admin.report_status', 'abuse_report', $id, ['status' => $status], $ip);
            }

            return 'ok';
        });
        if ($updated === 'actor_changed') {
            return response()->json(['error' => 'Tu rol, cuenta o MFA cambió. Vuelve a autenticarte'], 409);
        }
        if ($updated === 'not_found') {
            return response()->json(['error' => 'Denuncia no encontrada'], 404);
        }

        return response()->json(['ok' => true]);
    }

    /** Apply a moderation decision and its link transition atomically. */
    public function moderateReport(Request $request, int $id)
    {
        $action = UvhRequest::inputString($request, 'action');
        if (! in_array($action, ['block', 'unblock', 'review', 'dismiss'], true)) {
            return response()->json(['error' => 'Acción de moderación inválida'], 422);
        }
        $reason = trim(UvhRequest::inputString($request, 'reason'));
        if (! mb_check_encoding($reason, 'UTF-8') || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', $reason)) {
            return response()->json(['error' => 'El motivo contiene caracteres no válidos'], 422);
        }
        if ($action === 'block' && (mb_strlen($reason) < 3 || mb_strlen($reason) > 500)) {
            return response()->json(['error' => 'Indica un motivo de entre 3 y 500 caracteres'], 422);
        }
        if ($action !== 'block' && mb_strlen($reason) > 500) {
            return response()->json(['error' => 'El comentario no puede superar 500 caracteres'], 422);
        }

        $actorId = UvhRequest::user($request)->id;
        $sessionId = UvhRequest::sessionId($request);
        $ip = UvhRequest::ip($request);
        $result = DB::transaction(function () use ($id, $action, $reason, $actorId, $sessionId, $ip): ?array {
            if (! $this->lockEligibleAdmin($actorId, $sessionId)) {
                return ['status' => 'actor_changed'];
            }
            $report = DB::table('abuse_reports')->where('id', $id)->lockForUpdate()->first();
            if (! $report) {
                return null;
            }
            $link = DB::table('links')->where('id', $report->link_id)->lockForUpdate()->first();
            if (! $link) {
                return null;
            }

            $linkState = (string) $link->state;
            $reportStatus = (string) $report->status;
            if ($action === 'block') {
                $linkState = $this->applyLinkBlock($link);
                $reportStatus = 'actioned';
            } elseif ($action === 'unblock') {
                $linkState = $this->applyLinkUnblock($link);
                $reportStatus = 'actioned';
            } elseif ($action === 'review') {
                $reportStatus = 'reviewed';
            } else {
                $reportStatus = 'dismissed';
            }

            if ((string) $report->status !== $reportStatus) {
                DB::table('abuse_reports')->where('id', $id)->update(['status' => $reportStatus]);
            }
            Audit::write($actorId, 'admin.report_moderate', 'abuse_report', $id, array_filter([
                'action' => $action,
                'linkId' => (int) $link->id,
                'reason' => $reason !== '' ? $reason : null,
                'linkState' => $linkState,
                'reportStatus' => $reportStatus,
            ], fn ($value) => $value !== null), $ip, workspaceId: (int) $link->workspace_id);

            return ['status' => 'ok', 'linkState' => $linkState, 'reportStatus' => $reportStatus];
        });
        if ($result === null) {
            return response()->json(['error' => 'Denuncia no encontrada'], 404);
        }
        if ($result['status'] === 'actor_changed') {
            return response()->json(['error' => 'Tu rol, cuenta o MFA cambió. Vuelve a autenticarte'], 409);
        }
        unset($result['status']);

        return response()->json(['ok' => true] + $result);
    }

    public function blockLink(Request $request, int $id)
    {
        $reason = trim(UvhRequest::inputString($request, 'reason'));
        if (! mb_check_encoding($reason, 'UTF-8') || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', $reason)
            || mb_strlen($reason) < 3 || mb_strlen($reason) > 500) {
            return response()->json(['error' => 'Motivo requerido'], 422);
        }

        $actorId = UvhRequest::user($request)->id;
        $sessionId = UvhRequest::sessionId($request);
        $ip = UvhRequest::ip($request);
        $updated = DB::transaction(function () use ($id, $reason, $actorId, $sessionId, $ip): string {
            if (! $this->lockEligibleAdmin($actorId, $sessionId)) {
                return 'actor_changed';
            }
            $row = DB::table('links')->where('id', $id)->lockForUpdate()->first();
            if (! $row) {
                return 'not_found';
            }
            $this->applyLinkBlock($row);
            Audit::write($actorId, 'admin.link_block', 'link', $id, ['reason' => $reason], $ip, workspaceId: (int) $row->workspace_id);

            return 'ok';
        });
        if ($updated === 'actor_changed') {
            return response()->json(['error' => 'Tu rol, cuenta o MFA cambió. Vuelve a autenticarte'], 409);
        }
        if ($updated === 'not_found') {
            return response()->json(['error' => 'Enlace no encontrado'], 404);
        }

        return response()->json(['ok' => true]);
    }

    public function unblockLink(Request $request, int $id)
    {
        $actorId = UvhRequest::user($request)->id;
        $sessionId = UvhRequest::sessionId($request);
        $ip = UvhRequest::ip($request);
        $result = DB::transaction(function () use ($id, $actorId, $sessionId, $ip): array {
            if (! $this->lockEligibleAdmin($actorId, $sessionId)) {
                return ['status' => 'actor_changed'];
            }
            $row = DB::table('links')->where('id', $id)->lockForUpdate()->first();
            if (! $row) {
                return ['status' => 'not_found'];
            }

            $state = $this->applyLinkUnblock($row);
            Audit::write($actorId, 'admin.link_unblock', 'link', $id, ['state' => $state], $ip, workspaceId: (int) $row->workspace_id);

            return ['status' => 'ok', 'state' => $state];
        });
        if ($result['status'] === 'actor_changed') {
            return response()->json(['error' => 'Tu rol, cuenta o MFA cambió. Vuelve a autenticarte'], 409);
        }
        if ($result['status'] === 'not_found') {
            return response()->json(['error' => 'Enlace no encontrado'], 404);
        }

        return response()->json(['ok' => true, 'state' => $result['state']]);
    }

    /** List support-reviewed MFA recovery cases without bearer material. */
    public function accountRecoveries(Request $request)
    {
        [$page, $perPage] = $this->pagination($request);
        $status = UvhRequest::queryString($request, 'status');
        if (! in_array($status, ['', 'requested', 'email_confirmed', 'in_review', 'approved', 'rejected', 'completed', 'expired', 'cancelled'], true)) {
            return response()->json(['error' => 'Estado de recuperación inválido'], 422);
        }
        $search = $this->search($request);
        $query = DB::table('account_recovery_requests as r')
            ->join('users as u', 'u.id', '=', 'r.user_id')
            ->leftJoin('account_recovery_approvals as a', 'a.request_id', '=', 'r.id')
            ->leftJoin('users as au', 'au.id', '=', 'a.admin_user_id')
            ->when($status !== '', fn ($q) => $q->where('r.status', $status))
            ->when($search !== '', function ($q) use ($search) {
                $needle = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower($search)).'%';
                $q->where(function ($nested) use ($needle) {
                    $nested->whereRaw("lower(u.email) LIKE ? ESCAPE '\\\\'", [$needle])
                        ->orWhereRaw("lower(u.name) LIKE ? ESCAPE '\\\\'", [$needle]);
                });
            })
            ->groupBy('r.id', 'u.id', 'u.email', 'u.name', 'u.is_admin', 'u.mfa_enabled');
        $total = DB::query()->fromSub((clone $query)->select('r.id'), 'recovery_count')->count();
        $rows = $query
            ->orderByRaw("CASE r.status WHEN 'email_confirmed' THEN 0 WHEN 'in_review' THEN 1 WHEN 'requested' THEN 2 WHEN 'approved' THEN 3 ELSE 4 END")
            ->orderByDesc('r.created_at')
            ->orderByDesc('r.id')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get([
                'r.id', 'r.user_id', 'r.status', 'r.email_confirmed_at', 'r.approved_at',
                'r.rejected_at', 'r.completed_at', 'r.expires_at', 'r.created_at', 'r.updated_at',
                'u.email', 'u.name', 'u.is_admin', 'u.mfa_enabled',
                DB::raw('COUNT(a.id) FILTER (WHERE au.is_admin = TRUE AND au.mfa_enabled = TRUE AND au.email_verified_at IS NOT NULL AND au.deleted_at IS NULL) AS approval_count'),
            ]);

        return response()->json([
            'recoveries' => $rows->map(fn ($row) => [
                'id' => (int) $row->id,
                'userId' => (int) $row->user_id,
                'name' => $row->name,
                'email' => $row->email,
                'status' => $row->status,
                'approvalCount' => (int) $row->approval_count,
                'targetIsAdmin' => (bool) $row->is_admin,
                'mfaEnabled' => (bool) $row->mfa_enabled,
                'emailConfirmedAt' => $row->email_confirmed_at,
                'approvedAt' => $row->approved_at,
                'rejectedAt' => $row->rejected_at,
                'completedAt' => $row->completed_at,
                'expiresAt' => $row->expires_at,
                'createdAt' => $row->created_at,
                'updatedAt' => $row->updated_at,
            ]),
            'total' => $total,
            'page' => $page,
            'perPage' => $perPage,
        ]);
    }

    /** Record one dual-control decision after external identity verification. */
    public function decideAccountRecovery(Request $request, int $id)
    {
        $decision = UvhRequest::inputString($request, 'decision');
        $reasonCode = UvhRequest::inputString($request, 'reasonCode');
        $verified = $request->boolean('identityVerified');
        if (! in_array($decision, ['approve', 'reject'], true)
            || ($decision === 'approve' && (! $verified || $reasonCode !== 'identity_verified_external'))
            || ($decision === 'reject' && ! in_array($reasonCode, ['insufficient_evidence', 'suspected_abuse'], true))) {
            return response()->json(['error' => 'Confirma la verificación y selecciona una decisión válida'], 422);
        }

        $actor = UvhRequest::user($request);
        $sessionId = UvhRequest::sessionId($request);
        $snapshot = AccountRecoveryRequest::where('id', $id)->first(['id', 'user_id']);
        if (! $snapshot) {
            return response()->json(['error' => 'Expediente no encontrado'], 404);
        }
        $targetUserId = (int) $snapshot->user_id;
        try {
            $result = DB::transaction(function () use ($actor, $sessionId, $id, $targetUserId, $decision, $reasonCode): array {
                // Every recovery decision locks the same user set in primary-key
                // order. Without deterministic ordering, two administrators
                // approving one another's cases can deadlock PostgreSQL.
                $lockedUsers = User::whereIn('id', [$targetUserId, $actor->id])
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->get()
                    ->keyBy('id');
                $row = AccountRecoveryRequest::where('id', $id)
                    ->where('user_id', $targetUserId)
                    ->lockForUpdate()
                    ->first();
                if (! $row) {
                    return ['status' => 'not_found'];
                }
                $target = $lockedUsers->get($targetUserId);
                $lockedActor = $lockedUsers->get($actor->id);
                if (! $this->eligibleLockedAdminSession($lockedActor, $sessionId)) {
                    return ['status' => 'actor_changed'];
                }
                if (! $target || ! $target->email_verified_at || ! $target->mfa_enabled
                    || (int) $target->security_version !== (int) $row->security_version
                    || $row->expires_at->isPast()) {
                    $row->update([
                        'status' => 'expired',
                        'confirmation_token_hash' => null,
                        'completion_token_hash' => null,
                        'updated_at' => now(),
                    ]);

                    return ['status' => 'stale'];
                }
                if ((int) $target->id === (int) $lockedActor->id) {
                    return ['status' => 'self'];
                }
                if (! in_array($row->status, ['email_confirmed', 'in_review'], true)) {
                    return ['status' => 'state'];
                }

                if ($decision === 'reject') {
                    DB::table('account_recovery_approvals')->where('request_id', $row->id)->delete();
                    $row->update([
                        'status' => 'rejected',
                        'completion_token_hash' => null,
                        'completion_expires_at' => null,
                        'rejected_at' => now(),
                        'updated_at' => now(),
                    ]);
                    if (! UvhMail::accountRecoveryRejected($target->email)) {
                        throw new MailAdmissionException('Account recovery rejection outbox admission failed');
                    }

                    return ['status' => 'rejected', 'user_id' => (int) $target->id];
                }

                DB::table('account_recovery_approvals')->insertOrIgnore([
                    'request_id' => $row->id,
                    'admin_user_id' => $lockedActor->id,
                    'reason_code' => $reasonCode,
                    'created_at' => now(),
                ]);
                $approvalCount = DB::table('account_recovery_approvals as a')
                    ->join('users as u', 'u.id', '=', 'a.admin_user_id')
                    ->where('a.request_id', $row->id)
                    ->where('u.is_admin', true)
                    ->where('u.mfa_enabled', true)
                    ->whereNotNull('u.email_verified_at')
                    ->whereNull('u.deleted_at')
                    ->distinct('a.admin_user_id')
                    ->count('a.admin_user_id');
                if ($approvalCount < 2) {
                    $row->update(['status' => 'in_review', 'updated_at' => now()]);

                    return ['status' => 'in_review', 'user_id' => (int) $target->id, 'approvals' => $approvalCount];
                }

                $token = Ids::randomToken(32);
                $generation = Ids::sha256Hex($token);
                $url = rtrim((string) config('app.url'), '/').'/auth/account-recovery/complete#token='.rawurlencode($token);
                $row->update([
                    'status' => 'approved',
                    'completion_token_hash' => $generation,
                    'completion_expires_at' => now()->addMinutes(30),
                    'approved_at' => now(),
                    'updated_at' => now(),
                ]);
                if (! UvhMail::accountRecoveryApproved($target->email, $url, (int) $row->id, $generation)) {
                    throw new MailAdmissionException('Account recovery completion outbox admission failed');
                }

                return ['status' => 'approved', 'user_id' => (int) $target->id, 'approvals' => $approvalCount];
            });
        } catch (MailAdmissionException) {
            return response()->json(['error' => 'No se pudo admitir el correo de recuperación. No se ha aplicado la decisión final'], 503);
        }

        if ($result['status'] === 'not_found') {
            return response()->json(['error' => 'Expediente no encontrado'], 404);
        }
        if ($result['status'] === 'actor_changed') {
            return response()->json(['error' => 'Tu rol o MFA cambió. Vuelve a autenticarte'], 409);
        }
        if ($result['status'] === 'self') {
            return response()->json(['error' => 'No puedes aprobar tu propia recuperación'], 403);
        }
        if ($result['status'] === 'stale') {
            return response()->json(['error' => 'La cuenta o el expediente cambió y ya no puede aprobarse'], 409);
        }
        if ($result['status'] === 'state') {
            return response()->json(['error' => 'El expediente no está pendiente de decisión'], 409);
        }

        Audit::write($actor->id, 'admin.account_recovery_decision', 'account_recovery', $id, [
            'decision' => $decision,
            'result' => $result['status'],
            'approval_count' => $result['approvals'] ?? 0,
        ], UvhRequest::ip($request));

        return response()->json([
            'ok' => true,
            'status' => $result['status'],
            'approvalCount' => $result['approvals'] ?? 0,
        ]);
    }

    public function domains(Request $request)
    {
        [$page, $perPage] = $this->pagination($request);
        $search = $this->search($request);
        $state = UvhRequest::queryString($request, 'state');
        $validStates = ['', 'pending', 'verifying', 'verified', 'provisioning', 'active', 'error', 'disabled'];
        if (! in_array($state, $validStates, true)) {
            return response()->json(['error' => 'Filtro de dominio inválido'], 422);
        }

        $query = DB::table('custom_domains as d')
            ->join('workspaces as w', 'w.id', '=', 'd.workspace_id')
            ->select('d.id', 'd.workspace_id', 'd.domain', 'd.state', 'd.verified_at', 'd.created_at', 'd.updated_at', 'w.name as workspace_name');
        if ($state !== '') {
            $query->where('d.state', $state);
        }
        if ($search !== '') {
            $like = "%{$search}%";
            $query->where(fn ($q) => $q->where('d.domain', 'ilike', $like)->orWhere('w.name', 'ilike', $like));
        }

        $total = (clone $query)->count();
        $rows = $query->orderByDesc('d.created_at')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get();

        return response()->json([
            'domains' => $rows,
            'total' => $total,
            'page' => $page,
            'perPage' => $perPage,
        ]);
    }

    public function audit(Request $request)
    {
        [$page, $perPage] = $this->pagination($request, 50);
        $search = $this->search($request);
        $action = mb_substr(trim(UvhRequest::queryString($request, 'action')), 0, 100);
        $resourceType = mb_substr(trim(UvhRequest::queryString($request, 'resourceType')), 0, 100);

        $query = DB::table('audit_events');
        if ($search !== '') {
            $like = "%{$search}%";
            $query->where(function ($q) use ($like) {
                $q->where('action', 'ilike', $like)
                    ->orWhere('resource_type', 'ilike', $like)
                    ->orWhere('resource_id', 'ilike', $like);
            });
        }
        if ($action !== '') {
            $query->where('action', $action);
        }
        if ($resourceType !== '') {
            $query->where('resource_type', $resourceType);
        }

        $total = (clone $query)->count();
        $rows = $query->orderByDesc('created_at')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get();

        return response()->json([
            'events' => $rows,
            'total' => $total,
            'page' => $page,
            'perPage' => $perPage,
        ]);
    }

    /** Return operator-facing health without exposing secrets or topology. */
    public function operations()
    {
        $environment = app()->environment();
        $production = $environment === 'production';
        $queueHeartbeatAge = $this->heartbeatAge('queue');
        $schedulerHeartbeatAge = $this->heartbeatAge('scheduler');
        $checks = [
            $this->operationCheck('environment', 'Entorno', $production, 'La aplicación no se está ejecutando como producción.', $production),
            $this->operationCheck('debug', 'Depuración', ! (bool) config('app.debug'), 'APP_DEBUG está activado.', $production),
            $this->operationCheck('https', 'Origen HTTPS', str_starts_with((string) config('app.url'), 'https://'), 'APP_URL no usa HTTPS.', $production),
            $this->operationCheck(
                'cookies',
                'Cookies de sesión',
                (bool) config('uvh.cookie_secure')
                    && (string) config('uvh.cookie_domain') === ''
                    && str_starts_with((string) config('uvh.session_cookie'), '__Host-')
                    && str_starts_with((string) config('uvh.csrf_cookie'), '__Host-'),
                'Las cookies no tienen el aislamiento requerido para producción.',
                $production,
            ),
            $this->operationCheck('hsts', 'HSTS', (bool) config('uvh.hsts_enabled'), 'HSTS no está activado.', $production),
            $this->operationCheck(
                'trusted_proxies',
                'Proxies confiables',
                ProductionSecurity::validTrustedProxies((string) config('uvh.trusted_proxies')),
                'TRUSTED_PROXIES no contiene una lista concreta válida.',
                $production,
            ),
            $this->operationCheck(
                'database',
                'PostgreSQL cifrado',
                config('database.default') === 'pgsql' && config('database.connections.pgsql.sslmode') === 'verify-full',
                'La conexión principal no usa PostgreSQL con verify-full.',
                $production,
            ),
            $this->operationCheck(
                'cache',
                'Caché compartida',
                in_array((string) config('cache.default'), ['database', 'redis', 'memcached', 'dynamodb'], true),
                'La caché no es compartida entre procesos.',
                $production,
            ),
            $this->operationCheck(
                'queue',
                'Cola persistente',
                ! in_array((string) config('queue.default'), ['', 'sync', 'null', 'background', 'deferred'], true),
                'La cola no es persistente o se ejecuta en el proceso web.',
                $production,
            ),
            $this->operationCheck(
                'queue_worker',
                'Worker de cola',
                $queueHeartbeatAge !== null && $queueHeartbeatAge <= 180,
                'No hay un heartbeat reciente de un worker de cola.',
                $production,
            ),
            $this->operationCheck(
                'scheduler',
                'Planificador',
                $schedulerHeartbeatAge !== null && $schedulerHeartbeatAge <= 210,
                'No hay un heartbeat reciente del scheduler.',
                $production,
            ),
            $this->operationCheck(
                'mail',
                'Entrega de correo',
                MailTransportPolicy::deliveryLeaves(config('mail')) !== null,
                'La configuración de correo contiene un transporte que no garantiza entrega real.',
                $production,
            ),
            $this->operationCheck(
                'hcaptcha',
                'hCaptcha',
                trim((string) config('uvh.hcaptcha.site_key')) !== '' && trim((string) config('uvh.hcaptcha.secret')) !== '',
                'hCaptcha no está configurado.',
                $production,
            ),
            $this->operationCheck(
                'custom_domain_edge',
                'Edge de dominios',
                ProductionSecurity::validHostname(strtolower(trim((string) config('uvh.custom_domains.cname_target'), '.')))
                    && strlen((string) config('uvh.custom_domains.edge_ask_secret')) >= 43,
                'El destino CNAME o la autorización privada del edge no están configurados.',
                $production,
            ),
        ];

        $jobCount = DB::table('jobs')->count();
        $oldestJob = DB::table('jobs')->min('created_at');
        $failedJobs = DB::table('failed_jobs')->count();
        // The same bounded-cardinality counters exported to Prometheus are
        // surfaced here so an operator can diagnose the last hour even before
        // an external monitoring stack is connected. No route or actor labels
        // are persisted in operational_metrics.
        $events60m = OperationalMetrics::totals(60);
        $deliveryCounts = $this->countsByState('webhook_deliveries', 'status');
        // created_at intentionally survives retries: an old delivery must not
        // look young simply because housekeeping re-enqueued it recently.
        $oldestPendingWebhook = DB::table('webhook_deliveries')
            ->whereIn('status', ['pending', 'processing'])
            ->min('created_at');
        $oldestPendingWebhookAge = $oldestPendingWebhook !== null
            ? max(0, time() - Carbon::parse($oldestPendingWebhook)->getTimestamp())
            : null;
        $mailOutboxCounts = $this->countsByState('mail_outbox', 'status');
        $oldestPendingMail = DB::table('mail_outbox')
            ->whereIn('status', ['pending', 'queued', 'processing', 'comp_pending', 'compensating'])
            ->min('created_at');
        $oldestPendingMailAge = $oldestPendingMail !== null
            ? max(0, time() - Carbon::parse($oldestPendingMail)->getTimestamp())
            : null;
        $checks[] = $this->operationCheck(
            'mail_queue_age',
            'Antigüedad del correo',
            $oldestPendingMailAge === null || $oldestPendingMailAge <= 600,
            'El correo pendiente más antiguo supera los diez minutos.',
            $production,
        );
        $domainCounts = $this->countsByState('custom_domains', 'state');
        // Revalidations keep their visible domain state. Compare the check
        // timestamps to include them, and fall back to updated_at for legacy
        // rows that entered verifying before dns_check_started_at was added.
        $oldestDnsCheck = DB::table('custom_domains')
            ->where(function ($query) {
                $query->where('state', 'verifying')
                    ->orWhere(function ($revalidation) {
                        $revalidation->whereIn('state', ['active', 'verified', 'disabled'])
                            ->whereNotNull('dns_check_started_at')
                            ->where(function ($inProgress) {
                                $inProgress->whereNull('dns_check_completed_at')
                                    ->orWhereColumn('dns_check_started_at', '>', 'dns_check_completed_at');
                            });
                    });
            })
            ->min(DB::raw('COALESCE(dns_check_started_at, updated_at)'));
        $oldestDnsCheckAge = $oldestDnsCheck !== null
            ? max(0, time() - Carbon::parse($oldestDnsCheck)->getTimestamp())
            : null;
        $oldestTlsProvisioning = DB::table('custom_domains')->where('state', 'provisioning')->min('updated_at');
        $oldestTlsProvisioningAge = $oldestTlsProvisioning !== null
            ? max(0, time() - Carbon::parse($oldestTlsProvisioning)->getTimestamp())
            : null;
        // These thresholds match housekeeping recovery windows. Crossing one
        // means the automated recovery should already have acted, so the
        // state is operationally actionable rather than normal queue latency.
        $checks[] = $this->operationCheck(
            'webhook_queue_age',
            'Antigüedad de webhooks',
            $oldestPendingWebhookAge === null || $oldestPendingWebhookAge <= 600,
            'La entrega webhook pendiente más antigua supera los diez minutos.',
            $production,
        );
        $checks[] = $this->operationCheck(
            'dns_check_age',
            'Verificación DNS',
            $oldestDnsCheckAge === null || $oldestDnsCheckAge <= 600,
            'Hay una verificación DNS en curso desde hace más de diez minutos.',
            $production,
        );
        $checks[] = $this->operationCheck(
            'tls_provisioning_age',
            'Emisión TLS',
            $oldestTlsProvisioningAge === null || $oldestTlsProvisioningAge <= 3600,
            'Hay una emisión TLS en curso desde hace más de una hora.',
            $production,
        );
        $activeSessions = DB::table('sessions')
            ->whereNull('revoked_at')
            ->where('expires_at', '>', now())
            ->count();
        $unverifiedUsers = DB::table('users')
            ->whereNull('deleted_at')
            ->whereNull('email_verified_at')
            ->count();
        $activePrivacyRequests = DB::table('privacy_rights_requests')
            ->whereIn('status', ['submitted', 'in_progress', 'waiting_user'])->count();
        $overduePrivacyRequests = DB::table('privacy_rights_requests')
            ->whereIn('status', ['submitted', 'in_progress', 'waiting_user'])
            ->whereRaw('COALESCE(extended_until, due_at) < NOW()')->count();

        $state = collect($checks)->contains(fn ($check) => $check['status'] === 'critical')
            ? 'critical'
            : (collect($checks)->contains(fn ($check) => $check['status'] === 'warning')
                || $failedJobs > 0
                || ($deliveryCounts['failed'] ?? 0) > 0
                || ($mailOutboxCounts['failed'] ?? 0) > 0
                || ($mailOutboxCounts['comp_pending'] ?? 0) > 0
                || ($mailOutboxCounts['compensating'] ?? 0) > 0
                // Availability/durability failures make the summary require
                // attention for the same 60-minute window shown to operators.
                // Invalid hCaptcha attempts and 429s remain informational:
                // they can reflect expected hostile or quota-limited traffic.
                || ($events60m['http.server_error'] ?? 0) > 0
                || ($events60m['hcaptcha.unavailable'] ?? 0) > 0
                || ($events60m['audit.write_failed'] ?? 0) > 0
                || ($events60m['housekeeping.stage_failed'] ?? 0) > 0
                || $overduePrivacyRequests > 0
                ? 'attention'
                : 'healthy');

        return response()->json([
            'state' => $state,
            'environment' => $environment,
            'generatedAt' => now()->toIso8601String(),
            'checks' => $checks,
            'metrics' => [
                'pendingJobs' => $jobCount,
                'oldestJobAgeSeconds' => $oldestJob !== null ? max(0, time() - (int) $oldestJob) : null,
                'failedJobs' => $failedJobs,
                'webhookDeliveries' => $deliveryCounts,
                'oldestPendingWebhookAgeSeconds' => $oldestPendingWebhookAge,
                'mailOutbox' => $mailOutboxCounts,
                'oldestPendingMailAgeSeconds' => $oldestPendingMailAge,
                'activeSessions' => $activeSessions,
                'unverifiedUsers' => $unverifiedUsers,
                'domains' => $domainCounts,
                'oldestDnsCheckAgeSeconds' => $oldestDnsCheckAge,
                'oldestTlsProvisioningAgeSeconds' => $oldestTlsProvisioningAge,
                'events60m' => $events60m,
                'queueHeartbeatAgeSeconds' => $queueHeartbeatAge,
                'schedulerHeartbeatAgeSeconds' => $schedulerHeartbeatAge,
                'activePrivacyRequests' => $activePrivacyRequests,
                'overduePrivacyRequests' => $overduePrivacyRequests,
            ],
        ]);
    }

    /** List outbox metadata without recipients, subjects, bodies or bearer URLs. */
    public function mailOutbox(Request $request)
    {
        [$page, $perPage] = $this->pagination($request);
        $status = UvhRequest::queryString($request, 'status');
        if (! in_array($status, ['', 'pending', 'queued', 'processing', 'sent', 'failed', 'obsolete', 'comp_pending', 'compensating', 'compensated'], true)) {
            return response()->json(['error' => 'Estado de correo inválido'], 422);
        }
        $query = DB::table('mail_outbox')
            ->when($status !== '', fn ($q) => $q->where('status', $status));
        $total = (clone $query)->count();
        $rows = $query->orderByDesc('created_at')->orderByDesc('id')
            ->offset(($page - 1) * $perPage)->limit($perPage)
            ->get([
                'id', 'kind', 'resource_type', 'status', 'attempts', 'manual_retry_count',
                'available_at', 'queued_at', 'locked_at', 'sent_at', 'failed_at',
                'last_manual_retry_at', 'last_error', 'created_at', 'updated_at',
                'encrypted_envelope', 'resource_id', 'resource_generation',
            ]);

        return response()->json([
            'messages' => $rows->map(function ($row): array {
                $retryable = false;
                if ($row->status === 'failed' && $row->encrypted_envelope !== ''
                    && (int) $row->manual_retry_count < 3
                    && Carbon::parse($row->created_at)->gte(now()->subHours(self::MAIL_MANUAL_RETRY_MAX_AGE_HOURS))) {
                    try {
                        $retryable = MailDeliveryEligibility::isCurrent($row);
                    } catch (\Throwable) {
                        $retryable = false;
                    }
                }

                return [
                    'id' => (int) $row->id,
                    'kind' => (string) $row->kind,
                    'resourceType' => is_string($row->resource_type) ? $row->resource_type : null,
                    'status' => (string) $row->status,
                    'attempts' => (int) $row->attempts,
                    'manualRetryCount' => (int) $row->manual_retry_count,
                    'retryable' => $retryable,
                    'availableAt' => $row->available_at,
                    'queuedAt' => $row->queued_at,
                    'lockedAt' => $row->locked_at,
                    'sentAt' => $row->sent_at,
                    'failedAt' => $row->failed_at,
                    'lastManualRetryAt' => $row->last_manual_retry_at,
                    'lastError' => $row->last_error,
                    'createdAt' => $row->created_at,
                    'updatedAt' => $row->updated_at,
                ];
            }),
            'total' => $total,
            'page' => $page,
            'perPage' => $perPage,
        ]);
    }

    /** Re-open one failed, still-current message under a bounded retry budget. */
    public function retryMailOutbox(Request $request, int $id)
    {
        $actorId = (int) UvhRequest::user($request)->id;
        $sessionId = UvhRequest::sessionId($request);
        try {
            $result = DB::transaction(function () use ($id, $actorId, $sessionId): string {
                if (! $this->lockEligibleAdmin($actorId, $sessionId)) {
                    return 'actor_changed';
                }
                $row = DB::table('mail_outbox')->where('id', $id)->lockForUpdate()->first();
                if (! $row) {
                    return 'not_found';
                }
                if ($row->status !== 'failed') {
                    return 'state';
                }
                if ($row->encrypted_envelope === '' || (int) $row->manual_retry_count >= 3
                    || Carbon::parse($row->created_at)->lt(now()->subHours(self::MAIL_MANUAL_RETRY_MAX_AGE_HOURS))) {
                    return 'limit';
                }
                if (! MailDeliveryEligibility::isCurrent($row)) {
                    DB::table('mail_outbox')->where('id', $id)->update([
                        'status' => 'obsolete',
                        'encrypted_envelope' => '',
                        'last_error' => 'lifecycle_obsolete',
                        'updated_at' => now(),
                    ]);

                    return 'obsolete';
                }
                DB::table('mail_outbox')->where('id', $id)->update([
                    'status' => 'pending',
                    'attempts' => 0,
                    'manual_retry_count' => (int) $row->manual_retry_count + 1,
                    'available_at' => now(),
                    'queued_at' => null,
                    'locked_at' => null,
                    'lock_token' => null,
                    'failed_at' => null,
                    'last_manual_retry_at' => now(),
                    'last_error' => null,
                    'updated_at' => now(),
                ]);

                return 'queued';
            });
        } catch (\Throwable) {
            return response()->json(['error' => 'No se pudo verificar el estado del correo. No se ha reintentado'], 503);
        }

        if ($result === 'not_found') {
            return response()->json(['error' => 'Correo no encontrado'], 404);
        }
        if ($result === 'actor_changed') {
            return response()->json(['error' => 'Tu rol, cuenta o MFA cambió. Vuelve a autenticarte'], 409);
        }
        if ($result === 'state') {
            return response()->json(['error' => 'El correo ya no está en estado fallido'], 409);
        }
        if ($result === 'limit') {
            return response()->json(['error' => 'El correo superó su ventana o límite de reintentos manuales'], 409);
        }
        if ($result === 'obsolete') {
            OperationalMetrics::increment('mail.obsolete');

            return response()->json(['error' => 'El enlace o evento de este correo ya no es válido'], 409);
        }

        OperationalMetrics::increment('mail.manual_retry');
        Audit::write($actorId, 'admin.mail_retry', 'mail_outbox', $id, null, UvhRequest::ip($request));
        $published = MailOutboxDispatcher::enqueue($id);

        return response()->json(['ok' => true, 'status' => $published ? 'queued' : 'pending'], 202);
    }

    /** @return array{0: int, 1: int} */
    private function pagination(Request $request, int $defaultPerPage = 25): array
    {
        // Admin endpoints join several operational tables. Bounding OFFSET
        // prevents a privileged-but-stale client from forcing pathological
        // scans while preserving ample room for the current UI pagination.
        $page = $this->positiveInteger($request->query('page'), 1, 10_000);
        $perPage = $this->positiveInteger($request->query('perPage'), $defaultPerPage, 100);

        return [$page, $perPage];
    }

    /** Lock and revalidate a privileged actor at the mutation boundary. */
    private function lockEligibleAdmin(int $actorId, ?string $sessionId): ?object
    {
        $actor = DB::table('users')->where('id', $actorId)->lockForUpdate()->first();

        return $this->eligibleLockedAdminSession($actor, $sessionId) ? $actor : null;
    }

    /** The caller already owns the user lock; now bind authority to this live session. */
    private function eligibleLockedAdminSession(?object $actor, ?string $sessionId): bool
    {
        if (! $actor || $sessionId === null || $actor->deleted_at !== null
            || $actor->email_verified_at === null || ! (bool) $actor->is_admin || ! (bool) $actor->mfa_enabled) {
            return false;
        }
        $session = DB::table('sessions')->where('id', $sessionId)->where('user_id', $actor->id)
            ->whereNull('revoked_at')->lockForUpdate()->first();
        if (! $session || (int) $session->security_version !== (int) $actor->security_version
            || Carbon::parse($session->expires_at)->isPast() || $session->mfa_verified_at === null) {
            return false;
        }
        $freshMinutes = max(1, min(60, (int) config('uvh.admin_mfa_fresh_minutes', 15)));

        return Carbon::parse($session->mfa_verified_at)->gte(now()->subMinutes($freshMinutes));
    }

    private function positiveInteger(mixed $value, int $default, int $max): int
    {
        if (is_string($value) && preg_match('/^[0-9]+$/D', $value) === 1) {
            $value = (int) $value;
        }
        if (! is_int($value) || $value < 1) {
            return $default;
        }

        return min($value, $max);
    }

    private function search(Request $request): string
    {
        return mb_substr(trim(UvhRequest::queryString($request, 'q')), 0, 100);
    }

    private function restoredLinkState(object $link): string
    {
        $now = now();
        if ($link->expires_at !== null && Carbon::parse($link->expires_at)->lte($now)) {
            return 'expired';
        }
        if ($link->scheduled_at !== null && Carbon::parse($link->scheduled_at)->gt($now)) {
            return 'scheduled';
        }

        return 'active';
    }

    /** Preserve an administrative block across the soft-delete/restore flow. */
    private function applyLinkBlock(object $link): string
    {
        if ($link->deleted_at !== null) {
            if ((string) $link->state !== 'deleted' || (string) $link->state_before_delete !== 'blocked') {
                DB::table('links')->where('id', $link->id)->update([
                    'state' => 'deleted',
                    'state_before_delete' => 'blocked',
                    'version' => DB::raw('version + 1'),
                    'updated_at' => now(),
                ]);
            }

            return 'deleted';
        }

        if ((string) $link->state !== 'blocked') {
            DB::table('links')->where('id', $link->id)->update([
                'state' => 'blocked',
                'version' => DB::raw('version + 1'),
                'updated_at' => now(),
            ]);
        }

        return 'blocked';
    }

    /** Remove either a live block or the protected tombstone of a deleted link. */
    private function applyLinkUnblock(object $link): string
    {
        $deleted = $link->deleted_at !== null;
        $blocked = (string) $link->state === 'blocked'
            || ($deleted && (string) $link->state_before_delete === 'blocked');
        if (! $blocked) {
            return (string) $link->state;
        }

        $restored = $this->restoredLinkState($link);
        DB::table('links')->where('id', $link->id)->update([
            'state' => $deleted ? 'deleted' : $restored,
            'state_before_delete' => $deleted ? $restored : $link->state_before_delete,
            'version' => DB::raw('version + 1'),
            'updated_at' => now(),
        ]);

        return $deleted ? 'deleted' : $restored;
    }

    /** @return array<string, int> */
    private function countsByState(string $table, string $column): array
    {
        return DB::table($table)
            ->select($column, DB::raw('COUNT(*) as aggregate'))
            ->groupBy($column)
            ->pluck('aggregate', $column)
            ->map(fn ($value) => (int) $value)
            ->all();
    }

    private function heartbeatAge(string $component): ?int
    {
        try {
            $value = Cache::get('uvh:health:'.$component);
            if (! is_int($value) && ! (is_string($value) && ctype_digit($value))) {
                return null;
            }

            return max(0, time() - (int) $value);
        } catch (\Throwable) {
            return null;
        }
    }

    /** @return array{key: string, label: string, status: string, detail: string|null} */
    private function operationCheck(string $key, string $label, bool $passes, string $failure, bool $critical): array
    {
        return [
            'key' => $key,
            'label' => $label,
            'status' => $passes ? 'ok' : ($critical ? 'critical' : 'warning'),
            'detail' => $passes ? null : $failure,
        ];
    }
}
