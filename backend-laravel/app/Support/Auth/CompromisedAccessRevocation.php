<?php

namespace App\Support\Auth;

use App\Models\AccountDeletionRequest;
use App\Models\DataExportRequest;
use App\Models\EmailChangeRequest;
use App\Models\EmailToken;
use App\Models\User;
use App\Support\AccountRecoveryLifecycle;
use Illuminate\Support\Facades\DB;

/** Consumes incident authority and applies all protective changes in one commit. */
final class CompromisedAccessRevocation
{
    /**
     * Mailbox possession stops access but never grants identity or removes MFA.
     * The caller validates syntax; the snapshot only locates the locked owner.
     * Artifact cleanup and cache minimization run after this business commit.
     *
     * @return array{user_id: int, artifacts: array<int, array{id: int, path: string}>, blocked: bool}|null
     */
    public static function admit(EmailToken $snapshot, string $tokenHash): ?array
    {
        return DB::transaction(function () use ($snapshot, $tokenHash): ?array {
            // Include soft-blocked/grace-period accounts: this link is allowed
            // to stop a hostile pending deletion, but never authenticates.
            $user = User::where('id', $snapshot->user_id)->lockForUpdate()->first();
            $row = EmailToken::where('id', $tokenHash)
                ->where('user_id', $snapshot->user_id)
                ->where('kind', 'security_revoke')
                ->whereNull('used_at')
                ->lockForUpdate()
                ->first();
            if (! $row || $row->used_at || $row->expires_at->lte(now())) {
                return null;
            }
            if (! $user) {
                return null;
            }

            $deletion = AccountDeletionRequest::where('user_id', $user->id)->lockForUpdate()->first();
            if ($user->deleted_at && (! $deletion || $deletion->status !== 'scheduled')) {
                // Never let an old email undo an administrative block.
                EmailToken::where('user_id', $user->id)->where('kind', 'security_revoke')->whereNull('used_at')->update(['used_at' => now()]);
                SecurityIncidentAudit::record($user, true);

                return ['user_id' => (int) $user->id, 'artifacts' => [], 'blocked' => true];
            }

            $artifacts = DataExportRequest::where('user_id', $user->id)
                ->whereIn('status', ['processing', 'ready'])
                ->whereNotNull('artifact_path')
                ->get(['id', 'artifact_path'])
                ->filter(fn ($export) => is_string($export->artifact_path) && $export->artifact_path !== '')
                ->map(fn ($export) => ['id' => (int) $export->id, 'path' => (string) $export->artifact_path])
                ->values()
                ->all();
            DataExportRequest::where('user_id', $user->id)
                ->whereIn('status', ['processing', 'ready'])
                ->update([
                    'status' => 'cancelled',
                    'mail_generation_hash' => null,
                    'updated_at' => now(),
                ]);

            $now = now();
            $user->update([
                'deleted_at' => null,
                'mfa_pending_secret' => null,
                'mfa_pending_expires_at' => null,
                'security_version' => (int) $user->security_version + 1,
                'updated_at' => $now,
            ]);
            DB::table('sessions')->where('user_id', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
            DB::table('api_tokens')->where('created_by', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
            EmailChangeRequest::where('user_id', $user->id)->delete();
            EmailToken::where('user_id', $user->id)->where('kind', 'reset')->whereNull('used_at')->delete();
            EmailToken::where('user_id', $user->id)->where('kind', 'security_revoke')->whereNull('used_at')->update(['used_at' => $now]);
            AccountRecoveryLifecycle::cancelActiveForUser((int) $user->id, $now);

            if ($deletion && in_array($deletion->status, ['requested', 'scheduled'], true)) {
                $deletion->update([
                    'status' => 'cancelled',
                    'confirmation_token_hash' => null,
                    'cancel_token_hash' => null,
                    'cancelled_at' => $now,
                    'updated_at' => $now,
                ]);
            }

            SecurityIncidentAudit::record($user, false);

            return ['user_id' => (int) $user->id, 'artifacts' => $artifacts, 'blocked' => false];
        });
    }
}
