<?php

namespace App\Support;

use App\Models\AccountDeletionRequest;
use App\Models\AccountRecoveryRequest;
use App\Models\DataExportRequest;
use App\Models\Invitation;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Reverses only lifecycle state that would become unsafe without its email.
 * Every comparison is generation-aware so an old failure cannot undo a newer
 * invitation, export or account-deletion transition.
 */
final class MailLifecycleCompensator
{
    public static function supports(
        string $kind,
        ?string $resourceType,
        int|string|null $resourceId,
        ?string $resourceGeneration,
    ): bool {
        if (self::numericId($resourceId) === null || ! self::validGeneration($resourceGeneration)) {
            return false;
        }

        return match ($resourceType) {
            'invitation' => $kind === 'invitation',
            'data_export' => in_array($kind, ['data_export_confirmation', 'data_export_ready'], true),
            'account_recovery' => in_array($kind, ['account_recovery_confirmation', 'account_recovery_approved'], true),
            'account_deletion' => in_array($kind, ['account_deletion_confirmation', 'account_deletion_scheduled'], true),
            default => false,
        };
    }

    public static function compensate(
        string $kind,
        ?string $resourceType,
        int|string|null $resourceId,
        ?string $resourceGeneration,
    ): void {
        $numericId = self::numericId($resourceId);

        if ($resourceType === 'invitation' && $numericId !== null
            && $kind === 'invitation' && is_string($resourceGeneration)
            && preg_match('/^[a-f0-9]{64}$/D', $resourceGeneration)) {
            DB::transaction(function () use ($numericId, $resourceGeneration): void {
                $row = Invitation::where('id', $numericId)->lockForUpdate()->first();
                if (! $row || $row->status !== 'pending' || ! is_string($row->token)
                    || ! hash_equals($row->token, $resourceGeneration)) {
                    return;
                }
                $row->update(['status' => 'cancelled']);
            });

            return;
        }

        if ($resourceType === 'data_export' && $numericId !== null
            && self::validGeneration($resourceGeneration)) {
            DB::transaction(function () use ($kind, $numericId, $resourceGeneration): void {
                $row = DataExportRequest::where('id', $numericId)->lockForUpdate()->first();
                if (! $row) {
                    return;
                }
                $expected = $kind === 'data_export_confirmation' ? 'requested' : 'ready';
                $hashField = $kind === 'data_export_confirmation' ? 'confirmation_token_hash' : 'download_token_hash';
                if ($row->status !== $expected || ! is_string($row->{$hashField})
                    || ! hash_equals($row->{$hashField}, $resourceGeneration)) {
                    return;
                }
                $path = $row->artifact_path;
                if (is_string($path) && $path !== '') {
                    if (! PrivateArtifactCleanup::isManagedPath($path)) {
                        throw new \RuntimeException('Invalid private export artifact path');
                    }
                    $disk = Storage::disk('local');
                    if ($disk->exists($path) && ! $disk->delete($path)) {
                        throw new \RuntimeException('Private export artifact cleanup failed');
                    }
                }
                $row->update([
                    'status' => 'failed',
                    'confirmation_token_hash' => null,
                    'download_token_hash' => null,
                    'artifact_path' => null,
                ]);
            });

            return;
        }

        if ($resourceType === 'account_recovery' && $numericId !== null
            && self::validGeneration($resourceGeneration)) {
            DB::transaction(function () use ($kind, $numericId, $resourceGeneration): void {
                $row = AccountRecoveryRequest::where('id', $numericId)->lockForUpdate()->first();
                if (! $row) {
                    return;
                }
                if ($kind === 'account_recovery_confirmation'
                    && $row->status === 'requested'
                    && is_string($row->confirmation_token_hash)
                    && hash_equals($row->confirmation_token_hash, $resourceGeneration)) {
                    $row->update([
                        'status' => 'cancelled',
                        'confirmation_token_hash' => null,
                        'confirmation_expires_at' => null,
                    ]);

                    return;
                }
                if ($kind === 'account_recovery_approved'
                    && $row->status === 'approved'
                    && is_string($row->completion_token_hash)
                    && hash_equals($row->completion_token_hash, $resourceGeneration)) {
                    DB::table('account_recovery_approvals')->where('request_id', $row->id)->delete();
                    $row->update([
                        'status' => 'email_confirmed',
                        'completion_token_hash' => null,
                        'completion_expires_at' => null,
                        'approved_at' => null,
                    ]);
                }
            });

            return;
        }

        if ($resourceType !== 'account_deletion' || $numericId === null
            || ! self::validGeneration($resourceGeneration)) {
            return;
        }
        $snapshot = AccountDeletionRequest::where('id', $numericId)->first(['id', 'user_id']);
        if (! $snapshot) {
            return;
        }
        $restoredUserId = DB::transaction(function () use ($kind, $snapshot, $resourceGeneration): ?int {
            // All account-deletion transitions serialize on the user before
            // touching the lifecycle row. This compensation can run at the
            // same instant as a cancel link or the housekeeping executor.
            $user = User::where('id', $snapshot->user_id)->lockForUpdate()->first();
            $row = AccountDeletionRequest::where('id', $snapshot->id)
                ->where('user_id', $snapshot->user_id)->lockForUpdate()->first();
            if (! $row) {
                return null;
            }
            if ($kind === 'account_deletion_confirmation' && $row->status === 'requested'
                && is_string($row->confirmation_token_hash)
                && hash_equals($row->confirmation_token_hash, $resourceGeneration)) {
                $row->update(['status' => 'cancelled', 'confirmation_token_hash' => null, 'cancelled_at' => now()]);

                return null;
            }
            if ($kind !== 'account_deletion_scheduled' || $row->status !== 'scheduled'
                || ! is_string($row->cancel_token_hash)
                || ! hash_equals($row->cancel_token_hash, $resourceGeneration)) {
                return null;
            }
            if (! $user || ! $user->deleted_at || (int) $user->security_version !== (int) $row->security_version) {
                return null;
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
            ]);

            return (int) $user->id;
        });
        if ($restoredUserId !== null) {
            Audit::write($restoredUserId, 'account.deletion_auto_restored_mail_failure', 'account_deletion', $numericId);
        }
    }

    private static function numericId(int|string|null $value): ?int
    {
        if (is_int($value) && $value > 0) {
            return $value;
        }
        if (is_string($value) && preg_match('/^[1-9][0-9]*$/D', $value)) {
            $number = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

            return is_int($number) ? $number : null;
        }

        return null;
    }

    private static function validGeneration(?string $value): bool
    {
        return is_string($value) && preg_match('/^[a-f0-9]{64}$/D', $value) === 1;
    }
}
