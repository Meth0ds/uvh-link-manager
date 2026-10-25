<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\AdminAccountRecoveryActions;
use App\Http\Controllers\Concerns\AdminOperationsQueries;
use App\Http\Controllers\Concerns\AdminUserQueries;
use App\Models\CustomDomain;
use App\Models\User;
use App\Support\AccountRecoveryLifecycle;
use App\Support\AdminText;
use App\Support\Audit;
use App\Support\BoundedPositiveInteger;
use App\Support\DestinationDenylist;
use App\Support\DestinationReputationService;
use App\Support\DomainStatus;
use App\Support\IsoDate;
use App\Support\LinkIntentRegistry;
use App\Support\MailDeliveryEligibility;
use App\Support\MailOutboxDispatcher;
use App\Support\MfaFreshness;
use App\Support\OperationalMetrics;
use App\Support\PrivateArtifactCleanup;
use App\Support\PublicSuffixes;
use App\Support\RegistrationGate;
use App\Support\SearchTerm;
use App\Support\UvhRequest;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminController
{
    use AdminAccountRecoveryActions;
    use AdminOperationsQueries;
    use AdminUserQueries;

    private const MAIL_MANUAL_RETRY_MAX_AGE_HOURS = 168;

    /**
     * `DomainStatus::legacyState` as SQL, used only to *filter*: each row's
     * label is derived in PHP from the model, never from this CASE. Keep the
     * two in step — `DomainAdminInspectorTest` compares them across fixtures.
     */
    private const LEGACY_STATE_CASE = <<<'SQL'
        CASE
            WHEN d.desired_state <> 'enabled' THEN 'disabled'
            WHEN d.edge_eligible AND d.tls_status = 'provisioning' THEN 'provisioning'
            WHEN d.desired_state = 'enabled' AND d.edge_eligible AND d.tls_ready_at IS NOT NULL THEN 'active'
            WHEN d.verified_at IS NULL AND d.ownership_status = 'pending'
                AND d.dns_check_started_at IS NOT NULL
                AND (d.dns_check_completed_at IS NULL OR d.dns_check_started_at > d.dns_check_completed_at)
                THEN 'verifying'
            WHEN d.verified_at IS NULL AND d.dns_error IS NOT NULL THEN 'error'
            WHEN d.verified_at IS NULL THEN 'pending'
            WHEN d.dns_error IS NOT NULL THEN 'error'
            ELSE 'verified'
        END
        SQL;

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
            'registrationPaused' => RegistrationGate::isPaused(),
        ]);
    }

    /**
     * Pausa o reanuda los registros NUEVOS. Los pendientes existentes
     * siguen su curso (verificación, reenvío, corrección); el estado también
     * se publica en `config` para que el formulario público lo anuncie.
     */
    public function setRegistrationPause(Request $request): JsonResponse
    {
        if (! $request->has('paused') || ! is_bool($request->input('paused'))) {
            return response()->json(['error' => __('messages.error_0aa9eb7787117b')], 422);
        }
        $paused = $request->input('paused');

        $actorId = UvhRequest::user($request)->id;
        $sessionId = UvhRequest::sessionId($request);
        $ip = UvhRequest::ip($request);
        $updated = DB::transaction(function () use ($paused, $actorId, $sessionId, $ip): string {
            if (! $this->lockEligibleAdmin($actorId, $sessionId)) {
                return 'actor_changed';
            }
            RegistrationGate::setPaused($paused, $actorId, $ip);

            return 'ok';
        });
        if ($updated === 'actor_changed') {
            return response()->json(['error' => __('messages.error_c32d79a75fdd37')], 409);
        }

        return response()->json(['ok' => true, 'paused' => $paused]);
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
            return response()->json(['error' => __('messages.error_0aa9eb7787117b')], 422);
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
                    ->whereIn('status', ['processing', 'ready'])
                    ->whereNotNull('artifact_path')->get(['id', 'artifact_path'])
                    ->filter(fn ($export) => is_string($export->artifact_path) && $export->artifact_path !== '')
                    ->map(fn ($export) => ['id' => (int) $export->id, 'path' => $export->artifact_path])
                    ->values()->all();
                DB::table('data_export_requests')->where('user_id', $id)
                    ->whereIn('status', ['processing', 'ready'])
                    ->update([
                        'status' => 'cancelled',
                        'mail_generation_hash' => null,
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
            return response()->json(['error' => __('messages.error_2b23ceeae12ac2')], 404);
        }
        if ($result['status'] === 'actor_changed') {
            return response()->json(['error' => __('messages.error_c32d79a75fdd37')], 409);
        }
        if ($result['status'] === 'last_admin') {
            return response()->json(['error' => __('messages.error_92eb3c3fcac206')], 403);
        }
        if ($result['status'] === 'admin_ineligible') {
            return response()->json(['error' => __('messages.error_64b17c1b20e9dc')], 409);
        }
        if ($result['status'] === 'deletion_scheduled') {
            return response()->json(['error' => __('messages.error_54e2b5dc0250ba')], 409);
        }
        if ($result['status'] === 'deletion_executed') {
            return response()->json(['error' => __('messages.error_c858500501afe9')], 409);
        }

        foreach ($result['artifacts'] as $artifact) {
            PrivateArtifactCleanup::afterCommit($artifact['id'], $artifact['path']);
        }
        if ($result['revoke_intents']) {
            LinkIntentRegistry::afterCommit($id, static function (array $intentRevocation) use ($actorId, $id, $ip): void {
                Audit::write($actorId, 'admin.user_intents_revoked', 'user', $id, $intentRevocation, $ip);
            });
        }

        return response()->json(['ok' => true]);
    }

    public function reports(Request $request)
    {
        [$page, $perPage] = $this->pagination($request);
        $search = $this->search($request);
        $status = UvhRequest::queryString($request, 'status');
        if (! in_array($status, ['', 'open', 'reviewed', 'actioned', 'dismissed'], true)) {
            return response()->json(['error' => __('messages.error_ab07bee0018115')], 422);
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
            $query->where(function ($q) use ($search) {
                $q->where('l.alias', 'ilike', $search)
                    ->orWhere('r.reason', 'ilike', $search)
                    ->orWhere('r.reporter_email', 'ilike', $search);
            });
        }

        $total = (clone $query)->count();
        $rows = $query->orderByDesc('r.created_at')->orderByDesc('r.id')
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
            return response()->json(['error' => __('messages.error_f49ab2eaafd27a')], 422);
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
            return response()->json(['error' => __('messages.error_c32d79a75fdd37')], 409);
        }
        if ($updated === 'not_found') {
            return response()->json(['error' => __('messages.error_961301d8d87c6d')], 404);
        }

        return response()->json(['ok' => true]);
    }

    /** Apply a moderation decision and its link transition atomically. */
    public function moderateReport(Request $request, int $id)
    {
        $action = UvhRequest::inputString($request, 'action');
        if (! in_array($action, ['block', 'unblock', 'review', 'dismiss'], true)) {
            return response()->json(['error' => __('messages.error_07eb433ff719ea')], 422);
        }
        $reason = trim(UvhRequest::inputString($request, 'reason'));
        if (! AdminText::encodable($reason)) {
            return response()->json(['error' => __('messages.error_593e88cb8cfe47')], 422);
        }
        if ($action === 'block' && ! AdminText::bounded($reason, 3, AdminText::MAX_REASON)) {
            return response()->json(['error' => __('messages.error_0d29a5bdd132dd')], 422);
        }
        if ($action !== 'block' && ! AdminText::bounded($reason, 0, AdminText::MAX_REASON)) {
            return response()->json(['error' => __('messages.error_d54a65612345a1')], 422);
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
            return response()->json(['error' => __('messages.error_961301d8d87c6d')], 404);
        }
        if ($result['status'] === 'actor_changed') {
            return response()->json(['error' => __('messages.error_c32d79a75fdd37')], 409);
        }
        unset($result['status']);

        return response()->json(['ok' => true] + $result);
    }

    public function blockLink(Request $request, int $id)
    {
        $reason = trim(UvhRequest::inputString($request, 'reason'));
        if (! AdminText::bounded($reason, 3, AdminText::MAX_REASON)) {
            return response()->json(['error' => __('messages.error_d9aacae86f0c30')], 422);
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
            return response()->json(['error' => __('messages.error_c32d79a75fdd37')], 409);
        }
        if ($updated === 'not_found') {
            return response()->json(['error' => __('messages.error_56cb73fa20e635')], 404);
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
            return response()->json(['error' => __('messages.error_c32d79a75fdd37')], 409);
        }
        if ($result['status'] === 'not_found') {
            return response()->json(['error' => __('messages.error_56cb73fa20e635')], 404);
        }

        return response()->json(['ok' => true, 'state' => $result['state']]);
    }

    /**
     * The cross-workspace domain inspector: health first, never the DNS
     * challenge (an admin views diagnosis, not the token that proves control).
     *
     * `state` is the pre-redesign label, derived from the status columns the
     * way `DomainStatus::legacyState` derives it; the SQL CASE only pushes the
     * same filter into the database so pagination stays honest.
     */
    public function domains(Request $request)
    {
        [$page, $perPage] = $this->pagination($request);
        $search = $this->search($request);
        $state = UvhRequest::queryString($request, 'state');
        $validStates = ['', 'pending', 'verifying', 'verified', 'provisioning', 'active', 'error', 'disabled'];
        if (! in_array($state, $validStates, true)) {
            return response()->json(['error' => __('messages.error_43be4a350ae514')], 422);
        }

        $query = DB::table('custom_domains as d')
            ->join('workspaces as w', 'w.id', '=', 'd.workspace_id')
            ->select(
                'd.id', 'd.workspace_id', 'd.domain', 'd.desired_state', 'd.ownership_status',
                'd.routing_status', 'd.tls_status', 'd.edge_eligible', 'd.tls_ready_at',
                'd.verified_at', 'd.dns_error', 'd.tls_error', 'd.tls_not_after',
                'd.dns_check_started_at', 'd.dns_check_completed_at',
                'd.created_at', 'd.updated_at', 'w.name as workspace_name',
                DB::raw('(SELECT COUNT(*) FROM links l WHERE l.domain_id = d.id AND l.deleted_at IS NULL) as links_count'),
            );
        if ($state !== '') {
            $query->whereRaw('('.self::LEGACY_STATE_CASE.') = ?', [$state]);
        }
        if ($search !== '') {
            $query->where(fn ($q) => $q->where('d.domain', 'ilike', $search)->orWhere('w.name', 'ilike', $search));
        }

        $total = (clone $query)->count();
        $rows = $query->orderByDesc('d.created_at')->orderByDesc('d.id')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get();

        return response()->json([
            'domains' => $rows->map(fn ($row) => $this->domainInspectorRow($row))->values(),
            'total' => $total,
            'page' => $page,
            'perPage' => $perPage,
        ]);
    }

    /**
     * One inspector row: the derived labels plus the raw facts an operator
     * needs to see *why* a domain is not serving.
     *
     * @return array<string, mixed>
     */
    private function domainInspectorRow(\stdClass $row): array
    {
        // The derived labels read model attributes (dates included); the row
        // is hydrated exactly as the ORM would from the same columns.
        $model = (new CustomDomain)->newFromBuilder((array) $row);

        return [
            'id' => (int) $row->id,
            'workspace_id' => (int) $row->workspace_id,
            'domain' => (string) $row->domain,
            'state' => DomainStatus::legacyState($model),
            'traffic_status' => DomainStatus::trafficStatus($model),
            'desired_state' => (string) $row->desired_state,
            'ownership_status' => (string) $row->ownership_status,
            'routing_status' => (string) $row->routing_status,
            'tls_status' => (string) $row->tls_status,
            'edge_eligible' => (bool) $row->edge_eligible,
            'dns_error' => $row->dns_error === null ? null : (string) $row->dns_error,
            'tls_error' => $row->tls_error === null ? null : (string) $row->tls_error,
            'verified_at' => IsoDate::format($row->verified_at),
            'tls_not_after' => IsoDate::format($row->tls_not_after),
            'links_count' => (int) $row->links_count,
            'created_at' => IsoDate::format($row->created_at),
            'updated_at' => IsoDate::format($row->updated_at),
            'workspace_name' => (string) $row->workspace_name,
        ];
    }

    public function audit(Request $request)
    {
        [$page, $perPage] = $this->pagination($request, 50);
        $search = $this->search($request);
        $action = mb_substr(trim(UvhRequest::queryString($request, 'action')), 0, 100);
        $resourceType = mb_substr(trim(UvhRequest::queryString($request, 'resourceType')), 0, 100);

        $query = DB::table('audit_events');
        if ($search !== '') {
            $query->where(function ($q) use ($search) {
                $q->where('action', 'ilike', $search)
                    ->orWhere('resource_type', 'ilike', $search)
                    ->orWhere('resource_id', 'ilike', $search);
            });
        }
        if ($action !== '') {
            $query->where('action', $action);
        }
        if ($resourceType !== '') {
            $query->where('resource_type', $resourceType);
        }

        $total = (clone $query)->count();
        $rows = $query->orderByDesc('created_at')->orderByDesc('id')
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

    /** List outbox metadata without recipients, subjects, bodies or bearer URLs. */
    public function mailOutbox(Request $request)
    {
        [$page, $perPage] = $this->pagination($request);
        $status = UvhRequest::queryString($request, 'status');
        if (! in_array($status, ['', 'pending', 'queued', 'processing', 'sent', 'failed', 'obsolete', 'comp_pending', 'compensating', 'compensated'], true)) {
            return response()->json(['error' => __('messages.error_d3e3bc1dc7f883')], 422);
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
            return response()->json(['error' => __('messages.error_b858b84d85fd5e')], 503);
        }

        if ($result === 'not_found') {
            return response()->json(['error' => __('messages.error_abff530bd556ca')], 404);
        }
        if ($result === 'actor_changed') {
            return response()->json(['error' => __('messages.error_c32d79a75fdd37')], 409);
        }
        if ($result === 'state') {
            return response()->json(['error' => __('messages.error_e2ac46f8dda6cb')], 409);
        }
        if ($result === 'limit') {
            return response()->json(['error' => __('messages.error_d21736b1996d08')], 409);
        }
        if ($result === 'obsolete') {
            OperationalMetrics::increment('mail.obsolete');

            return response()->json(['error' => __('messages.error_a4ffb4dcae34ee')], 409);
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
        $page = BoundedPositiveInteger::parse($request->query('page'), 1, 10_000);
        $perPage = BoundedPositiveInteger::parse($request->query('perPage'), $defaultPerPage, 100);

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
            || Carbon::parse($session->expires_at)->lte(now()) || $session->mfa_verified_at === null) {
            return false;
        }

        // The freshness window lives in MfaFreshness alone: a second
        // definition of its clamp is how two surfaces drift apart the day it
        // changes.
        return MfaFreshness::isFresh(Carbon::parse($session->mfa_verified_at));
    }

    /**
     * Appeals from owners of blocked links.
     *
     * These are the only way a false positive reaches a human: an automatic
     * block would otherwise be a decision nobody can contest.
     */
    public function appeals(Request $request): JsonResponse
    {
        [$page, $perPage] = $this->pagination($request);
        $status = UvhRequest::queryString($request, 'status');
        if (! in_array($status, ['', 'open', 'upheld', 'restored'], true)) {
            return response()->json(['error' => __('messages.error_2b210b193cad58')], 422);
        }

        $query = DB::table('link_appeals as a')
            ->join('links as l', 'l.id', '=', 'a.link_id')
            ->select(
                'a.id',
                'a.link_id',
                'a.message',
                'a.status',
                'a.created_at',
                'a.decided_at',
                'a.decision_note',
                'l.alias',
                'l.destination',
                'l.state as link_state',
                'l.workspace_id',
            );
        if ($status !== '') {
            $query->where('a.status', $status);
        }

        $total = (clone $query)->count();
        $rows = $query->orderByDesc('a.created_at')->orderByDesc('a.id')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get();

        return response()->json([
            'appeals' => $rows,
            'total' => $total,
            'page' => $page,
            'perPage' => $perPage,
        ]);
    }

    /**
     * Decide an appeal: restore the link, or uphold the block.
     *
     * Restoring also removes the denylist entries that apply to the link's
     * destinations. Without that the next re-analysis would block it again and
     * the appeal would be theatre. A provider-sourced entry can therefore be
     * overridden by a human, and the audit trail records exactly which entries
     * were removed.
     */
    public function resolveAppeal(Request $request, int $id): JsonResponse
    {
        $decision = UvhRequest::inputString($request, 'decision');
        if (! in_array($decision, ['restore', 'uphold'], true)) {
            return response()->json(['error' => __('messages.error_0ba5797b009033')], 422);
        }
        $note = trim(UvhRequest::inputString($request, 'note'));
        if (! AdminText::bounded($note, 0, AdminText::MAX_REASON)) {
            return response()->json(['error' => __('messages.error_d08fad2dc0a22e')], 422);
        }

        $actorId = UvhRequest::user($request)->id;
        $sessionId = UvhRequest::sessionId($request);
        $ip = UvhRequest::ip($request);
        $result = DB::transaction(function () use ($id, $decision, $note, $actorId, $sessionId, $ip): ?array {
            if (! $this->lockEligibleAdmin($actorId, $sessionId)) {
                return ['status' => 'actor_changed'];
            }
            $appeal = DB::table('link_appeals')->where('id', $id)->lockForUpdate()->first();
            if (! $appeal) {
                return null;
            }
            if ((string) $appeal->status !== 'open') {
                return ['status' => 'decided'];
            }
            $link = DB::table('links')->where('id', $appeal->link_id)->lockForUpdate()->first();
            if (! $link) {
                return null;
            }

            $removed = [];
            $state = (string) $link->state;
            if ($decision === 'restore') {
                $state = $this->applyLinkUnblock($link);
                foreach (DestinationReputationService::destinationsOf($link) as $destination) {
                    foreach (DestinationDenylist::entriesFor($destination) as $entry) {
                        if (DestinationDenylist::remove((int) $entry->id) === 1) {
                            $removed[] = $entry->match_kind.':'.mb_substr((string) $entry->match_value, 0, 8);
                        }
                    }
                }
            }

            DB::table('link_appeals')->where('id', $id)->update([
                'status' => $decision === 'restore' ? 'restored' : 'upheld',
                'decided_by' => $actorId,
                'decided_at' => now(),
                'decision_note' => $note === '' ? null : $note,
                'updated_at' => now(),
            ]);

            Audit::write($actorId, 'admin.link_appeal_resolved', 'link', (int) $link->id, array_filter([
                'appealId' => $id,
                'decision' => $decision,
                'state' => $state,
                // Counts and kinds only; the values are hashed or truncated and
                // belong to the denylist itself, not to the audit trail.
                'removedEntries' => $removed === [] ? null : count($removed),
                'note' => $note === '' ? null : $note,
            ], fn ($value) => $value !== null), $ip, workspaceId: (int) $link->workspace_id);

            return ['status' => 'ok', 'state' => $state, 'removed' => count($removed)];
        });
        if ($result === null) {
            return response()->json(['error' => __('messages.error_815d843caff7f3')], 404);
        }
        if ($result['status'] === 'actor_changed') {
            return response()->json(['error' => __('messages.error_c32d79a75fdd37')], 409);
        }
        if ($result['status'] === 'decided') {
            return response()->json(['error' => __('messages.error_30d24e424ce6ab')], 409);
        }

        return response()->json(['ok' => true, 'state' => $result['state'], 'removedEntries' => $result['removed']]);
    }

    /**
     * Promote a moderation block from one link to the destination it points at.
     *
     * Blocking only the link left the abuse intact: the same URL came back as a
     * new link minutes later, and could also be reached through a redirect rule.
     */
    public function blockDestination(Request $request, int $id): JsonResponse
    {
        $reason = trim(UvhRequest::inputString($request, 'reason'));
        if (! AdminText::bounded($reason, 3, AdminText::MAX_REASON)) {
            return response()->json(['error' => __('messages.error_d9aacae86f0c30')], 422);
        }
        $scope = UvhRequest::inputString($request, 'scope');
        $scope = $scope === '' ? 'url' : $scope;
        if (! in_array($scope, ['url', 'host'], true)) {
            return response()->json(['error' => __('messages.error_3891df89088e72')], 422);
        }

        $actorId = UvhRequest::user($request)->id;
        $sessionId = UvhRequest::sessionId($request);
        $ip = UvhRequest::ip($request);
        $result = DB::transaction(function () use ($id, $scope, $reason, $actorId, $sessionId, $ip): ?array {
            if (! $this->lockEligibleAdmin($actorId, $sessionId)) {
                return ['status' => 'actor_changed'];
            }
            $row = DB::table('links')->where('id', $id)->lockForUpdate()->first();
            if (! $row) {
                return null;
            }

            $host = DestinationDenylist::normalizeHost((string) (parse_url((string) $row->destination, PHP_URL_HOST) ?? ''));
            // A public suffix is not a registrable host: an entry for one would
            // take every site under it offline, which is never the intent of
            // blocking one link. Refused here, with a message that says so
            // instead of the generic "could not interpret the destination".
            if ($scope === 'host' && $host !== null && PublicSuffixes::isPublicSuffix($host)) {
                return ['status' => 'public_suffix'];
            }
            $entryId = $scope === 'host'
                ? ($host === null ? null : DestinationDenylist::blockHost($host, $reason, DestinationDenylist::SOURCE_REPORT, $actorId))
                : DestinationDenylist::blockUrl((string) $row->destination, $reason, DestinationDenylist::SOURCE_REPORT, $actorId);
            if ($entryId === null) {
                return ['status' => 'unsupported'];
            }

            Audit::write($actorId, 'admin.destination_block', 'link', (int) $row->id, [
                'cause' => $scope,
                'reason' => $reason,
            ], $ip, workspaceId: (int) $row->workspace_id);

            return ['status' => 'ok', 'host' => $host, 'entryId' => $entryId];
        });
        if ($result === null) {
            return response()->json(['error' => __('messages.error_56cb73fa20e635')], 404);
        }
        if ($result['status'] === 'actor_changed') {
            return response()->json(['error' => __('messages.error_c32d79a75fdd37')], 409);
        }
        if ($result['status'] === 'unsupported') {
            return response()->json(['error' => __('messages.error_533067d4dfcd62')], 422);
        }
        if ($result['status'] === 'public_suffix') {
            return response()->json(['error' => __('messages.error_032be6306989c6')], 422);
        }

        // Every link that could already point at the same host is re-evaluated
        // in the background; a new entry has to reach links that already exist.
        // The sweep is bounded, and it says so when the bound was reached: the
        // operator has to be able to tell a propagated block from a partial one.
        $sweep = $result['host'] === null
            ? ['scheduled' => 0, 'truncated' => false]
            : DestinationReputationService::reanalyzeHost($result['host']);

        return response()->json([
            'ok' => true,
            'entryId' => $result['entryId'],
            'linksScheduled' => $sweep['scheduled'],
            'linksSweepTruncated' => $sweep['truncated'],
        ]);
    }

    /** The destinations the platform currently refuses to serve. */
    public function denylist(Request $request): JsonResponse
    {
        [$page, $perPage] = $this->pagination($request);
        $query = DB::table('destination_denylist')->orderByDesc('id');
        $total = (clone $query)->count();
        $rows = $query->offset(($page - 1) * $perPage)->limit($perPage)->get();

        return response()->json([
            'entries' => $rows,
            'total' => $total,
            'page' => $page,
            'perPage' => $perPage,
        ]);
    }

    /** Withdraw a destination block, for example after a successful appeal. */
    public function removeDenylistEntry(Request $request, int $id): JsonResponse
    {
        $actorId = UvhRequest::user($request)->id;
        $sessionId = UvhRequest::sessionId($request);
        $ip = UvhRequest::ip($request);
        $removed = DB::transaction(function () use ($id, $actorId, $sessionId, $ip): string {
            if (! $this->lockEligibleAdmin($actorId, $sessionId)) {
                return 'actor_changed';
            }
            $entry = DB::table('destination_denylist')->where('id', $id)->lockForUpdate()->first();
            if (! $entry) {
                return 'not_found';
            }
            DestinationDenylist::remove($id);
            Audit::write($actorId, 'admin.destination_unblock', 'destination_denylist', $id, [
                'cause' => (string) $entry->source,
                'kind' => (string) $entry->match_kind,
            ], $ip);

            return 'ok';
        });
        if ($removed === 'actor_changed') {
            return response()->json(['error' => __('messages.error_c32d79a75fdd37')], 409);
        }
        if ($removed === 'not_found') {
            return response()->json(['error' => __('messages.error_333ff8e805f5d1')], 404);
        }

        // Outside the transaction: withdrawing an entry has to reach the links it
        // blocked. A URL entry stores only a hash, so the links cannot be looked
        // up from it — but they do not need to be, because every self-applied
        // denylist block is re-evaluated and only the ones with no remaining
        // ground are released. Bounded, and free of provider traffic.
        $released = DestinationReputationService::releaseUnlistedBlocks(
            max(1, min(500, (int) config('uvh.reputation.release_batch', 50)))
        );

        return response()->json(['ok' => true, 'releasedLinks' => $released]);
    }

    /** The `q` parameter as a bound ILIKE pattern, metacharacters escaped. */
    private function search(Request $request): string
    {
        return SearchTerm::contains(UvhRequest::queryString($request, 'q'), 100);
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
        // A human decision is not a machine one: the marker is cleared so the
        // platform's own withdrawal path can never lift this block later.
        $cleared = [
            'reputation_blocked_at' => null,
            'reputation_block_source' => null,
            'reputation_block_prior_state' => null,
        ];
        if ($link->deleted_at !== null) {
            if ((string) $link->state !== 'deleted' || (string) $link->state_before_delete !== 'blocked') {
                DB::table('links')->where('id', $link->id)->update([
                    'state' => 'deleted',
                    'state_before_delete' => 'blocked',
                    'version' => DB::raw('version + 1'),
                    'updated_at' => now(),
                ] + $cleared);
            }

            return 'deleted';
        }

        if ((string) $link->state !== 'blocked') {
            DB::table('links')->where('id', $link->id)->update([
                'state' => 'blocked',
                'version' => DB::raw('version + 1'),
                'updated_at' => now(),
            ] + $cleared);
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
            // The block is gone, so its marker must not outlive it: a stale
            // marker on a live link would let a later sweep "withdraw" a block
            // that is no longer there, or read a human decision as a machine one.
            'reputation_blocked_at' => null,
            'reputation_block_source' => null,
            'reputation_block_prior_state' => null,
        ]);

        return $deleted ? 'deleted' : $restored;
    }
}
