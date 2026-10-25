<?php

namespace App\Http\Controllers\Concerns;

use App\Models\AccountDeletionRequest;
use App\Models\DataExportRequest;
use App\Models\EmailChangeRequest;
use App\Models\EmailToken;
use App\Models\User;
use App\Models\UvhSession;
use App\Support\AccountDeletionAudit;
use App\Support\AccountRecoveryLifecycle;
use App\Support\Audit;
use App\Support\Auth\AccountReadContext;
use App\Support\Auth\CredentialChangeResponse;
use App\Support\FrontendUrl;
use App\Support\Ids;
use App\Support\LinkIntentRegistry;
use App\Support\MailAdmissionException;
use App\Support\MfaAttempts;
use App\Support\MfaFreshness;
use App\Support\MfaStepUp;
use App\Support\NotificationInbox;
use App\Support\NotificationKinds;
use App\Support\PrivateArtifactCleanup;
use App\Support\UvhMail;
use App\Support\UvhRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

trait AccountDeletionActions
{
    public function deletionImpact(Request $request)
    {
        $context = AccountReadContext::resolve(UvhRequest::user($request), UvhRequest::sessionId($request));
        if ($context === null) {
            return response()->json(['error' => __('messages.error_3fd9c1eb0bc788')], 401);
        }
        $user = $context->user;
        $owned = DB::table('workspaces')->where('owner_user_id', $user->id)
            ->orderBy('id')->limit(20)->get(['id', 'name', 'slug']);
        $pending = AccountDeletionRequest::where('user_id', $user->id)->first();
        $blockingPrivacy = DB::table('privacy_rights_requests')->where('user_id', $user->id)
            ->whereIn('status', ['submitted', 'in_progress', 'waiting_user'])
            ->where('type', '!=', 'erasure')->orderBy('id')->get(['id', 'type', 'status', 'due_at']);

        return response()->json([
            'canDelete' => ! $user->is_admin && $owned->isEmpty() && $blockingPrivacy->isEmpty(),
            'isPlatformAdmin' => (bool) $user->is_admin,
            'ownedWorkspaces' => $owned,
            'blockingPrivacyRequests' => $blockingPrivacy,
            'request' => $pending && $pending->status === 'requested'
                && (int) $pending->security_version === (int) $user->security_version
                && $pending->confirmation_expires_at?->isFuture()
                ? [
                    'status' => 'requested',
                    'confirmationExpiresAt' => $pending->confirmation_expires_at->toIso8601String(),
                ]
                : null,
        ]);
    }

    public function requestDeletion(Request $request)
    {
        $password = UvhRequest::inputString($request, 'password');
        $factorCode = trim(UvhRequest::inputString($request, 'factorCode'));
        $confirmation = trim(UvhRequest::inputString($request, 'confirmation'));
        if ($password === '' || strlen($password) > 72 || strlen($factorCode) > 24
            || ! hash_equals('ELIMINAR MI CUENTA', $confirmation)) {
            return response()->json(['error' => __('messages.error_fa0df89c26d891')], 422);
        }

        $user = UvhRequest::user($request);
        $purpose = 'account-deletion';
        if (MfaAttempts::tooMany($user->id, $purpose)) {
            return MfaAttempts::tooManyResponse($user->id, $purpose);
        }
        $token = Ids::randomToken(32);
        $url = FrontendUrl::base().'/auth/confirm-account-deletion#token='.rawurlencode($token);
        $sessionId = UvhRequest::sessionId($request);

        try {
            $result = DB::transaction(function () use ($user, $sessionId, $password, $factorCode, $purpose, $token, $url): array {
                $lockedUser = $this->lockVerifiedActor($user, $sessionId);
                $session = UvhSession::where('id', $sessionId)->where('user_id', $user->id)
                    ->whereNull('revoked_at')->lockForUpdate()->first();
                if (! $lockedUser || ! $session || ! $lockedUser->email_verified_at
                    || (int) $session->security_version !== (int) $lockedUser->security_version) {
                    return ['status' => 'stale'];
                }
                if ($lockedUser->is_admin) {
                    return ['status' => 'admin'];
                }
                $owned = DB::table('workspaces')->where('owner_user_id', $lockedUser->id)
                    ->orderBy('id')->limit(20)->get(['id', 'name', 'slug']);
                if ($owned->isNotEmpty()) {
                    return ['status' => 'owned', 'workspaces' => $owned];
                }
                $blockingPrivacy = DB::table('privacy_rights_requests')->where('user_id', $lockedUser->id)
                    ->whereIn('status', ['submitted', 'in_progress', 'waiting_user'])
                    ->where('type', '!=', 'erasure')->lockForUpdate()->get(['id', 'type']);
                if ($blockingPrivacy->isNotEmpty()) {
                    return ['status' => 'privacy', 'requests' => $blockingPrivacy];
                }

                $existing = AccountDeletionRequest::where('user_id', $lockedUser->id)->lockForUpdate()->first();
                if ($existing && ! AccountDeletionAudit::admit($existing)) {
                    return ['status' => 'audit_pending'];
                }
                if ($existing && $existing->status === 'requested'
                    && (int) $existing->security_version !== (int) $lockedUser->security_version) {
                    $existing->update(['status' => 'cancelled', 'confirmation_token_hash' => null]);
                }
                if ($existing && $existing->status === 'requested' && $existing->confirmation_expires_at?->isFuture()) {
                    return ['status' => 'active', 'expires_at' => $existing->confirmation_expires_at];
                }

                $stepUp = MfaStepUp::verify($lockedUser, $session, $password, $factorCode, true, $purpose);
                if ($stepUp['status'] !== 'ok') {
                    return ['status' => $stepUp['status']];
                }
                if (isset($stepUp['recovery_codes'])) {
                    $lockedUser->update(['recovery_codes' => $stepUp['recovery_codes'], 'updated_at' => now()]);
                }

                $expiresAt = now()->addHour();
                $values = [
                    'security_version' => (int) $lockedUser->security_version,
                    'status' => 'requested',
                    'confirmation_token_hash' => Ids::sha256Hex($token),
                    'cancel_token_hash' => null,
                    'confirmation_expires_at' => $expiresAt,
                    'execute_after' => null,
                    'confirmed_at' => null,
                    'cancelled_at' => null,
                    'executed_at' => null,
                ];
                if ($existing) {
                    $existing->update($values);
                    $row = $existing;
                } else {
                    $row = AccountDeletionRequest::create(['user_id' => $lockedUser->id, ...$values]);
                }
                if (! UvhMail::accountDeletionConfirmation(
                    $lockedUser->email,
                    $url,
                    (int) $row->id,
                    Ids::sha256Hex($token),
                )) {
                    throw new MailAdmissionException('Account deletion confirmation queue admission failed');
                }

                Audit::write($lockedUser->id, 'account.deletion_requested', 'account_deletion', $row->id, [
                    'factor' => $stepUp['factor'], 'grace_days_after_confirmation' => 7,
                ]);

                return ['status' => 'created', 'request_id' => (int) $row->id, 'expires_at' => $expiresAt, 'factor' => $stepUp['factor']];
            });
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['kind' => 'account_deletion_confirmation']);

            return response()->json(['error' => __('messages.error_56de9526b62aa7')], 503);
        }

        if ($result['status'] === 'audit_pending') {
            return response()->json(['error' => __('messages.error_27e655eb605814')], 503);
        }
        if ($result['status'] === 'stale') {
            return response()->json(['error' => __('messages.error_3fd9c1eb0bc788')], 409);
        }
        if ($result['status'] === 'admin') {
            return response()->json(['error' => __('messages.error_108b41c1870fcf')], 409);
        }
        if ($result['status'] === 'owned') {
            return response()->json([
                'error' => __('messages.error_da347b8a4d3967'),
                'ownedWorkspaces' => $result['workspaces'],
            ], 409);
        }
        if ($result['status'] === 'privacy') {
            return response()->json([
                'error' => __('messages.error_fabc9e0f18963c'),
                'privacyRequests' => $result['requests'],
            ], 409);
        }
        if ($result['status'] === 'active') {
            return response()->json([
                'error' => __('messages.error_67c53759e1b480'),
                'confirmationExpiresAt' => $result['expires_at']->toIso8601String(),
            ], 409);
        }
        if ($result['status'] === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, $purpose);
        }
        if ($result['status'] === 'reauth') {
            return MfaFreshness::reauthenticationRequired();
        }
        if ($result['status'] === 'password') {
            Audit::write($user->id, 'account.deletion_request_failed', 'user', $user->id, ['reason' => 'password']);

            return response()->json(['error' => __('messages.error_30124a1d7f08a4')], 403);
        }
        if ($result['status'] === 'factor') {
            Audit::write($user->id, 'account.deletion_request_failed', 'user', $user->id, ['reason' => 'factor']);

            return response()->json(['error' => __('messages.error_94f7173a80a9cb')], 403);
        }

        return response()->json([
            'status' => 'requested',
            'confirmationExpiresAt' => $result['expires_at']->toIso8601String(),
        ], 202);
    }

    public function confirmDeletion(Request $request)
    {
        $token = UvhRequest::inputString($request, 'token');
        if (! preg_match('/^[A-Za-z0-9_-]{43}$/D', $token)) {
            return response()->json(['error' => __('messages.error_f0bd101ade1cc6')], 422);
        }

        $tokenHash = Ids::sha256Hex($token);
        $snapshot = AccountDeletionRequest::where('confirmation_token_hash', $tokenHash)
            ->where('status', 'requested')->first(['id', 'user_id']);
        try {
            $result = $snapshot ? DB::transaction(function () use ($snapshot, $tokenHash): array {
                $user = User::where('id', $snapshot->user_id)->lockForUpdate()->first();
                $row = AccountDeletionRequest::where('id', $snapshot->id)
                    ->where('user_id', $snapshot->user_id)
                    ->where('confirmation_token_hash', $tokenHash)
                    ->where('status', 'requested')->lockForUpdate()->first();
                if (! $row) {
                    return ['status' => 'invalid'];
                }
                if ($row->confirmation_expires_at?->isFuture() !== true) {
                    $row->update(['status' => 'expired', 'confirmation_token_hash' => null]);

                    return ['status' => 'expired'];
                }
                if (! $user || $user->deleted_at
                    || (int) $user->security_version !== (int) $row->security_version || $user->is_admin) {
                    $row->update(['status' => 'blocked', 'confirmation_token_hash' => null]);

                    return ['status' => 'blocked'];
                }
                if (DB::table('workspaces')->where('owner_user_id', $user->id)->exists()) {
                    $row->update(['status' => 'blocked', 'confirmation_token_hash' => null]);

                    return ['status' => 'owned'];
                }
                if (DB::table('privacy_rights_requests')->where('user_id', $user->id)
                    ->whereIn('status', ['submitted', 'in_progress', 'waiting_user'])
                    ->where('type', '!=', 'erasure')->lockForUpdate()->exists()) {
                    $row->update(['status' => 'blocked', 'confirmation_token_hash' => null]);

                    return ['status' => 'privacy'];
                }

                $now = now();
                $executeAfter = $now->copy()->addDays(7);
                $cancelToken = Ids::randomToken(32);
                $cancelUrl = FrontendUrl::base().'/auth/cancel-account-deletion#token='.rawurlencode($cancelToken);
                NotificationInbox::record((int) $user->id, NotificationKinds::ACCOUNT_DELETION_SCHEDULED);
                if (! UvhMail::accountDeletionScheduled(
                    $user->email,
                    $cancelUrl,
                    $executeAfter->toIso8601String(),
                    (int) $row->id,
                    Ids::sha256Hex($cancelToken),
                )) {
                    throw new MailAdmissionException('Account deletion cancellation queue admission failed');
                }

                $nextVersion = (int) $user->security_version + 1;
                $user->update([
                    'deleted_at' => $now,
                    'security_version' => $nextVersion,
                    'mfa_pending_secret' => null,
                    'mfa_pending_expires_at' => null,
                    'updated_at' => $now,
                ]);
                $row->update([
                    'security_version' => $nextVersion,
                    'status' => 'scheduled',
                    'confirmation_token_hash' => null,
                    'cancel_token_hash' => Ids::sha256Hex($cancelToken),
                    'execute_after' => $executeAfter,
                    'confirmed_at' => $now,
                ]);
                DB::table('sessions')->where('user_id', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
                // Draft destinations and fetched metadata are ephemeral capabilities;
                // suspension removes them even when the deletion is later cancelled.
                DB::table('destination_inspections')->where('user_id', $user->id)->delete();
                DB::table('api_tokens')->where('created_by', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
                // Suspension revokes issued capabilities as well as received
                // invitations. Cancellation/compensation can restore this user,
                // but must not silently revive their pre-suspension bearers.
                // Acceptance locks the issuer first, so it cannot race this
                // transition using a previously observed active account.
                DB::table('invitations')->where('invited_by', $user->id)
                    ->where('status', 'pending')->update(['status' => 'cancelled']);
                DB::table('invitations')->whereRaw('lower(email) = ?', [strtolower($user->email)])
                    ->where('status', 'pending')->update(['status' => 'cancelled']);
                // Preserve explicit 24-hour incident links from password-change
                // notices. They are the last independent way to stop a hostile
                // deletion; every other verification/reset token is revoked.
                EmailToken::where('user_id', $user->id)->where('kind', '!=', 'security_revoke')->delete();
                EmailChangeRequest::where('user_id', $user->id)->delete();
                AccountRecoveryLifecycle::cancelActiveForUser((int) $user->id, $now);

                $artifacts = DataExportRequest::where('user_id', $user->id)
                    ->whereIn('status', ['processing', 'ready'])
                    ->whereNotNull('artifact_path')->get(['id', 'artifact_path'])
                    ->filter(fn ($export) => is_string($export->artifact_path) && $export->artifact_path !== '')
                    ->map(fn ($export) => ['id' => (int) $export->id, 'path' => $export->artifact_path])
                    ->values()->all();
                DataExportRequest::where('user_id', $user->id)
                    ->whereIn('status', ['processing', 'ready'])
                    ->update([
                        'status' => 'cancelled',
                        'mail_generation_hash' => null,
                        'updated_at' => $now,
                    ]);

                Audit::write($user->id, 'account.deletion_scheduled', 'account_deletion', $row->id, [
                    'execute_after' => $executeAfter->toIso8601String(),
                ]);

                return [
                    'status' => 'ok', 'user_id' => (int) $user->id, 'request_id' => (int) $row->id,
                    'execute_after' => $executeAfter, 'artifacts' => $artifacts,
                ];
            }) : ['status' => 'invalid'];
        } catch (MailAdmissionException) {
            return response()->json(['error' => __('messages.error_6a3a21b5501f76')], 503);
        }

        if ($result['status'] === 'expired') {
            return response()->json(['error' => __('messages.error_5432b0d986aa3a')], 400);
        }
        if ($result['status'] === 'owned') {
            return response()->json(['error' => __('messages.error_dfcec8b6816318')], 409);
        }
        if ($result['status'] === 'privacy') {
            return response()->json(['error' => __('messages.error_bc0ae9f2196066')], 409);
        }
        if ($result['status'] !== 'ok') {
            return response()->json(['error' => __('messages.error_7339224e567f8e')], 400);
        }
        foreach ($result['artifacts'] as $artifact) {
            PrivateArtifactCleanup::afterCommit($artifact['id'], $artifact['path']);
        }
        $userId = $result['user_id'];
        $requestId = $result['request_id'];
        $executeAfter = $result['execute_after']->toIso8601String();
        // Cached handoffs and their counters cannot roll back with PostgreSQL.
        // Reconcile only a durable suspension, including an enclosing commit.
        LinkIntentRegistry::afterCommit($userId, static function (array $intentRevocation) use ($userId, $requestId, $executeAfter): void {
            // This is secondary cleanup telemetry. Admission failure must not
            // become a business rollback or poison an enclosing transaction.
            Audit::write($userId, 'account.deletion_link_intents_reconciled', 'account_deletion', $requestId, [
                'execute_after' => $executeAfter,
                'link_intents_revoked' => $intentRevocation['revoked'],
                'link_intents_busy' => $intentRevocation['busy'],
            ]);
        });

        return CredentialChangeResponse::forUser($request, $result['user_id'], [
            'executeAfter' => $result['execute_after']->toIso8601String(),
        ]);
    }

    public function cancelDeletion(Request $request)
    {
        $token = UvhRequest::inputString($request, 'token');
        if (! preg_match('/^[A-Za-z0-9_-]{43}$/D', $token)) {
            return response()->json(['error' => __('messages.error_f0bd101ade1cc6')], 422);
        }

        $tokenHash = Ids::sha256Hex($token);
        $snapshot = AccountDeletionRequest::where('cancel_token_hash', $tokenHash)
            ->where('status', 'scheduled')->first(['id', 'user_id']);
        $result = $snapshot ? DB::transaction(function () use ($snapshot, $tokenHash): array {
            $user = User::where('id', $snapshot->user_id)->lockForUpdate()->first();
            $row = AccountDeletionRequest::where('id', $snapshot->id)
                ->where('user_id', $snapshot->user_id)
                ->where('cancel_token_hash', $tokenHash)
                ->where('status', 'scheduled')->lockForUpdate()->first();
            if (! $row || ! $row->execute_after || $row->execute_after->isPast()) {
                return ['status' => 'invalid'];
            }
            if (! $user || ! $user->deleted_at || (int) $user->security_version !== (int) $row->security_version) {
                return ['status' => 'invalid'];
            }
            $now = now();
            $user->update([
                'deleted_at' => null,
                'security_version' => (int) $user->security_version + 1,
                'updated_at' => $now,
            ]);
            $row->update([
                'status' => 'cancelled',
                'cancel_token_hash' => null,
                'cancelled_at' => $now,
                'cancellation_audit_pending' => true,
            ]);

            // Cancellation is a protective operation: a mail failure must not
            // leave irreversible deletion scheduled. Use a savepoint so a bad
            // INSERT cannot poison PostgreSQL's outer cancellation transaction.
            // On success the envelope still commits with the restored account.
            try {
                $noticeAdmitted = DB::transaction(function () use ($user): bool {
                    NotificationInbox::record((int) $user->id, NotificationKinds::ACCOUNT_DELETION_CANCELLED);
                    if (! UvhMail::accountDeletionCancelled($user->email)) {
                        throw new MailAdmissionException('Deletion cancellation notice outbox admission failed');
                    }

                    return true;
                });
            } catch (\Throwable) {
                $noticeAdmitted = false;
            }

            AccountDeletionAudit::admit($row);

            return [
                'status' => 'ok', 'user_id' => (int) $user->id, 'request_id' => (int) $row->id,
                'notice_admitted' => $noticeAdmitted,
            ];
        }) : ['status' => 'invalid'];

        if ($result['status'] !== 'ok') {
            return response()->json(['error' => __('messages.error_b3ed2cac93d11d')], 400);
        }
        if (! $result['notice_admitted']) {
            Audit::write($result['user_id'], 'auth.email_delivery_failed', 'user', $result['user_id'], ['kind' => 'account_deletion_cancelled']);
        }

        return response()->json(['ok' => true]);
    }
}
