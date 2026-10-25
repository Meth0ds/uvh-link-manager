<?php

namespace App\Http\Controllers\Concerns;

use App\Models\AccountRecoveryRequest;
use App\Models\User;
use App\Support\Audit;
use App\Support\FrontendUrl;
use App\Support\Ids;
use App\Support\MailAdmissionException;
use App\Support\NotificationInbox;
use App\Support\NotificationKinds;
use App\Support\NotificationPreferences;
use App\Support\UvhMail;
use App\Support\UvhRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

trait AdminAccountRecoveryActions
{
    /** List support-reviewed MFA recovery cases without bearer material. */
    public function accountRecoveries(Request $request)
    {
        [$page, $perPage] = $this->pagination($request);
        $status = UvhRequest::queryString($request, 'status');
        if (! in_array($status, ['', 'requested', 'email_confirmed', 'in_review', 'approved', 'rejected', 'completed', 'expired', 'cancelled'], true)) {
            return response()->json(['error' => __('messages.error_58fe8c7277acf6')], 422);
        }
        $search = $this->search($request);
        $query = DB::table('account_recovery_requests as r')
            ->join('users as u', 'u.id', '=', 'r.user_id')
            ->leftJoin('account_recovery_approvals as a', 'a.request_id', '=', 'r.id')
            ->leftJoin('users as au', 'au.id', '=', 'a.admin_user_id')
            ->when($status !== '', fn ($q) => $q->where('r.status', $status))
            ->when($search !== '', function ($q) use ($search) {
                // `$search` is already an escaped, bound pattern; lowercasing it
                // leaves the escape characters untouched and matches the two
                // `lower(...)` columns this join has to compare against.
                $needle = mb_strtolower($search);
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
                DB::raw('COUNT(a.id) FILTER (WHERE a.admin_user_id <> r.user_id AND au.is_admin = TRUE AND au.mfa_enabled = TRUE AND au.email_verified_at IS NOT NULL AND au.deleted_at IS NULL) AS approval_count'),
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
            return response()->json(['error' => __('messages.error_89f53f5a6395d2')], 422);
        }

        $actor = UvhRequest::user($request);
        $sessionId = UvhRequest::sessionId($request);
        $snapshot = AccountRecoveryRequest::where('id', $id)->first(['id', 'user_id']);
        if (! $snapshot) {
            return response()->json(['error' => __('messages.error_99909f70fde641')], 404);
        }
        $targetUserId = (int) $snapshot->user_id;
        try {
            $result = DB::transaction(function () use ($actor, $sessionId, $id, $targetUserId, $decision, $reasonCode, $request): array {
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
                // Admission belongs to the same transaction as the case change.
                // History materialization may retry later, but the exact event
                // must be durable before the decision can be committed.
                $admit = static function (array $result) use ($lockedActor, $row, $decision, $request): array {
                    Audit::write($lockedActor->id, 'admin.account_recovery_decision', 'account_recovery', $row->id, [
                        'decision' => $decision,
                        'result' => $result['status'],
                        'approval_count' => $result['approvals'] ?? 0,
                    ], UvhRequest::ip($request));

                    return $result;
                };
                if (! $target || $target->deleted_at || ! $target->email_verified_at || ! $target->mfa_enabled
                    || (int) $target->security_version !== (int) $row->security_version
                    || $row->expires_at->lte(now())) {
                    $row->update([
                        'status' => 'expired',
                        'confirmation_token_hash' => null,
                        'completion_token_hash' => null,
                        'updated_at' => now(),
                    ]);

                    return $admit(['status' => 'stale']);
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
                    $delivery = NotificationInbox::record(
                        (int) $target->id,
                        NotificationKinds::ACCOUNT_RECOVERY_REJECTED,
                        null,
                        null,
                        'account_recovery_rejected:'.$row->id,
                    );
                    if ($delivery === NotificationPreferences::DELIVERY_IMMEDIATE
                        && ! UvhMail::accountRecoveryRejected($target->email)) {
                        throw new MailAdmissionException('Account recovery rejection outbox admission failed');
                    }

                    return $admit(['status' => 'rejected', 'user_id' => (int) $target->id]);
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
                    ->where('a.admin_user_id', '<>', $target->id)
                    ->where('u.is_admin', true)
                    ->where('u.mfa_enabled', true)
                    ->whereNotNull('u.email_verified_at')
                    ->whereNull('u.deleted_at')
                    ->distinct('a.admin_user_id')
                    ->count('a.admin_user_id');
                if ($approvalCount < 2) {
                    $row->update(['status' => 'in_review', 'updated_at' => now()]);

                    return $admit(['status' => 'in_review', 'user_id' => (int) $target->id, 'approvals' => $approvalCount]);
                }

                $token = Ids::randomToken(32);
                $generation = Ids::sha256Hex($token);
                $url = FrontendUrl::base().'/auth/account-recovery/complete#token='.rawurlencode($token);
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

                return $admit(['status' => 'approved', 'user_id' => (int) $target->id, 'approvals' => $approvalCount]);
            });
        } catch (MailAdmissionException) {
            return response()->json(['error' => __('messages.error_232c73018a8fcc')], 503);
        }

        if ($result['status'] === 'not_found') {
            return response()->json(['error' => __('messages.error_99909f70fde641')], 404);
        }
        if ($result['status'] === 'actor_changed') {
            return response()->json(['error' => __('messages.error_88c3059a5168bb')], 409);
        }
        if ($result['status'] === 'self') {
            return response()->json(['error' => __('messages.error_c5d5441130813e')], 403);
        }
        if ($result['status'] === 'stale') {
            return response()->json(['error' => __('messages.error_dca623e906494f')], 409);
        }
        if ($result['status'] === 'state') {
            return response()->json(['error' => __('messages.error_bc3d990f5fceb8')], 409);
        }

        return response()->json([
            'ok' => true,
            'status' => $result['status'],
            'approvalCount' => $result['approvals'] ?? 0,
        ]);
    }
}
