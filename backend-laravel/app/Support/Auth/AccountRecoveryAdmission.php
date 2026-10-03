<?php

namespace App\Support\Auth;

use App\Models\AccountDeletionRequest;
use App\Models\AccountRecoveryRequest;
use App\Models\DataExportRequest;
use App\Models\EmailChangeRequest;
use App\Models\EmailToken;
use App\Models\User;
use App\Support\AccountRecoveryAdmissionException;
use App\Support\Audit;
use App\Support\FrontendUrl;
use App\Support\Ids;
use App\Support\MailAdmissionException;
use App\Support\PasswordStrength;
use App\Support\UvhMail;
use Illuminate\Support\Facades\DB;

/** Account recovery authority and mandatory admissions share each complete transaction. */
final class AccountRecoveryAdmission
{
    /** Public lookup grants no authority; account eligibility is rechecked under lock. */
    public static function request(User $user, string $email): void
    {
        DB::transaction(function () use ($user, $email): void {
            $locked = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
            if (! $locked || ! $locked->email_verified_at || ! $locked->mfa_enabled
                || ! hash_equals(strtolower($locked->email), strtolower($email))) {
                return;
            }
            $existing = AccountRecoveryRequest::where('user_id', $locked->id)
                ->whereIn('status', ['requested', 'email_confirmed', 'in_review', 'approved'])
                ->lockForUpdate()->first();
            if ($existing && ((int) $existing->security_version !== (int) $locked->security_version
                || $existing->expires_at->lte(now()))) {
                $existing->update([
                    'status' => 'expired',
                    'confirmation_token_hash' => null,
                    'completion_token_hash' => null,
                    'updated_at' => now(),
                ]);
                $existing = null;
            }
            if ($existing && ($existing->status !== 'requested'
                || $existing->updated_at->gt(now()->subMinute()))) {
                return;
            }

            $rawToken = Ids::randomToken(32);
            $generation = Ids::sha256Hex($rawToken);
            $confirmationExpiresAt = now()->addHour();
            $values = [
                'security_version' => (int) $locked->security_version,
                'status' => 'requested',
                'confirmation_token_hash' => $generation,
                'confirmation_expires_at' => $confirmationExpiresAt,
                'completion_token_hash' => null,
                'completion_expires_at' => null,
                'email_confirmed_at' => null,
                'approved_at' => null,
                'rejected_at' => null,
                'completed_at' => null,
                'expires_at' => now()->addDays(7),
            ];
            if ($existing) {
                DB::table('account_recovery_approvals')->where('request_id', $existing->id)->delete();
                $existing->update($values);
                $recovery = $existing;
            } else {
                $recovery = AccountRecoveryRequest::create(['user_id' => $locked->id, ...$values]);
            }
            $url = FrontendUrl::base().'/auth/account-recovery/confirm#token='.rawurlencode($rawToken);
            if (! UvhMail::accountRecoveryConfirmation($locked->email, $url, (int) $recovery->id, $generation)) {
                throw new MailAdmissionException('Account recovery confirmation outbox admission failed');
            }

            try {
                Audit::write($locked->id, 'auth.account_recovery_requested', 'account_recovery', $recovery->id);
            } catch (\Throwable $error) {
                // Roll back the case, bearer and mail together while
                // preserving the same public answer for every address.
                throw new AccountRecoveryAdmissionException('Recovery audit admission failed', 0, $error);
            }
        });
    }

    /** @return array{user_id:int,request_id:int}|null */
    public static function confirm(AccountRecoveryRequest $snapshot, string $tokenHash): ?array
    {
        return DB::transaction(function () use ($snapshot, $tokenHash): ?array {
            $user = User::where('id', $snapshot->user_id)->lockForUpdate()->first();
            $row = AccountRecoveryRequest::where('id', $snapshot->id)
                ->where('user_id', $snapshot->user_id)
                ->where('confirmation_token_hash', $tokenHash)
                ->where('status', 'requested')->lockForUpdate()->first();
            if (! $row || ! $row->confirmation_expires_at || $row->confirmation_expires_at->lte(now())
                || $row->expires_at->lte(now())) {
                if ($row) {
                    $row->update(['status' => 'expired', 'confirmation_token_hash' => null, 'updated_at' => now()]);
                }

                return null;
            }
            if (! $user || $user->deleted_at || ! $user->email_verified_at || ! $user->mfa_enabled
                || (int) $user->security_version !== (int) $row->security_version) {
                $row->update(['status' => 'expired', 'confirmation_token_hash' => null, 'updated_at' => now()]);

                return null;
            }
            $row->update([
                'status' => 'email_confirmed',
                'confirmation_token_hash' => null,
                'confirmation_expires_at' => null,
                'email_confirmed_at' => now(),
                'updated_at' => now(),
            ]);
            Audit::write($user->id, 'auth.account_recovery_email_confirmed', 'account_recovery', $row->id);

            return ['user_id' => (int) $user->id, 'request_id' => (int) $row->id];
        });
    }

    /**
     * All known accounts in ID order, then case. Never acquire a late approver lock.
     * Caller validates input and hashes outside locks; artifacts remain external.
     *
     * @param  list<int>  $expectedApproverIds
     * @return array{status:'invalid'|'weak'|'approval_changed'}|array{status:'ok',user_id:int,request_id:int,was_admin:bool,artifacts:array<int,array{id:int,path:mixed}>}
     */
    public static function complete(AccountRecoveryRequest $snapshot, string $token, string $password, string $passwordHash, array $expectedApproverIds): array
    {
        return DB::transaction(function () use ($token, $password, $passwordHash, $snapshot, $expectedApproverIds): array {
            // Match the global recovery lock order: all known user rows in
            // primary-key order, followed by the case row. If the approval set
            // changed since the preflight read we fail closed and require a new
            // review instead of acquiring a late, out-of-order user lock.
            $lockIds = array_values(array_unique([(int) $snapshot->user_id, ...$expectedApproverIds]));
            sort($lockIds, SORT_NUMERIC);
            $lockedUsers = User::whereIn('id', $lockIds)
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');
            $row = AccountRecoveryRequest::where('id', $snapshot->id)
                ->where('user_id', $snapshot->user_id)
                ->where('completion_token_hash', Ids::sha256Hex($token))
                ->where('status', 'approved')
                ->lockForUpdate()
                ->first();
            if (! $row || ! $row->completion_expires_at || $row->completion_expires_at->lte(now())
                || $row->expires_at->lte(now())) {
                if ($row) {
                    $row->update(['status' => 'expired', 'completion_token_hash' => null, 'updated_at' => now()]);
                }

                return ['status' => 'invalid'];
            }

            $approverIds = DB::table('account_recovery_approvals')
                ->where('request_id', $row->id)
                ->orderBy('admin_user_id')
                ->pluck('admin_user_id')
                ->map(fn ($id) => (int) $id)
                ->unique()
                ->values()
                ->all();
            if ($approverIds !== $expectedApproverIds) {
                $row->update([
                    'status' => 'in_review',
                    'completion_token_hash' => null,
                    'completion_expires_at' => null,
                    'approved_at' => null,
                    'updated_at' => now(),
                ]);

                return ['status' => 'approval_changed'];
            }
            $user = $lockedUsers->get($row->user_id);
            if (! $user || $user->deleted_at || ! $user->email_verified_at || ! $user->mfa_enabled
                || (int) $user->security_version !== (int) $row->security_version) {
                $row->update(['status' => 'expired', 'completion_token_hash' => null, 'updated_at' => now()]);

                return ['status' => 'invalid'];
            }
            $validApprovers = collect($approverIds)
                ->unique()
                ->filter(function (int $adminId) use ($lockedUsers, $user): bool {
                    $admin = $lockedUsers->get($adminId);

                    return (bool) ($admin
                        && $adminId !== (int) $user->id
                        && ! $admin->deleted_at
                        && $admin->email_verified_at
                        && $admin->is_admin
                        && $admin->mfa_enabled);
                })
                ->count();
            if ($validApprovers < 2) {
                $row->update([
                    'status' => 'in_review',
                    'completion_token_hash' => null,
                    'completion_expires_at' => null,
                    'approved_at' => null,
                    'updated_at' => now(),
                ]);

                return ['status' => 'approval_changed'];
            }

            if (! PasswordStrength::isAcceptable($password, $user->name, $user->email)) {
                return ['status' => 'weak'];
            }

            $now = now();
            $wasAdmin = (bool) $user->is_admin;
            $artifacts = DataExportRequest::where('user_id', $user->id)
                ->whereIn('status', ['processing', 'ready'])
                ->whereNotNull('artifact_path')
                ->get(['id', 'artifact_path'])
                ->filter(fn ($export) => is_string($export->artifact_path) && $export->artifact_path !== '')
                ->map(fn ($export) => ['id' => (int) $export->id, 'path' => $export->artifact_path])
                ->values()
                ->all();
            $user->update([
                'password_hash' => $passwordHash,
                'is_admin' => false,
                'mfa_enabled' => false,
                'mfa_secret' => null,
                'mfa_pending_secret' => null,
                'mfa_pending_expires_at' => null,
                'recovery_codes' => null,
                'security_version' => (int) $user->security_version + 1,
                'updated_at' => $now,
            ]);
            DB::table('sessions')->where('user_id', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
            DB::table('api_tokens')->where('created_by', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
            EmailToken::where('user_id', $user->id)->whereIn('kind', ['reset', 'security_revoke'])->delete();
            EmailChangeRequest::where('user_id', $user->id)->delete();
            DataExportRequest::where('user_id', $user->id)
                ->whereIn('status', ['processing', 'ready'])
                ->update([
                    'status' => 'cancelled',
                    'mail_generation_hash' => null,
                    'updated_at' => $now,
                ]);
            AccountDeletionRequest::where('user_id', $user->id)
                ->whereIn('status', ['requested', 'scheduled'])
                ->update([
                    'status' => 'cancelled',
                    'confirmation_token_hash' => null,
                    'confirmation_expires_at' => null,
                    'cancel_token_hash' => null,
                    'updated_at' => $now,
                ]);
            $row->update([
                'status' => 'completed',
                'completion_token_hash' => null,
                'completion_expires_at' => null,
                'completed_at' => $now,
                'updated_at' => $now,
            ]);

            SecurityIncidentNotice::passwordChanged($user);
            Audit::write($user->id, 'auth.account_recovery_completed', 'account_recovery', $row->id, [
                'mfa_disabled' => true,
                'platform_admin_removed' => $wasAdmin,
            ]);

            return [
                'status' => 'ok',
                'user_id' => (int) $user->id,
                'request_id' => (int) $row->id,
                'was_admin' => $wasAdmin,
                'artifacts' => $artifacts,
            ];
        });
    }
}
