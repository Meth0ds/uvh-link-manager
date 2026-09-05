<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Decides whether an outbox message still represents live account state.
 * The encrypted envelope is deliberately not inspected and no PII is exposed.
 */
final class MailDeliveryEligibility
{
    // Historical notices are not bearer grants. A later email/MFA transition
    // must not suppress a warning already admitted with an earlier commit.
    // Callers still need transactional admission for mandatory security events.
    private const SAFE_NOTIFICATIONS = [
        'account_recovery_rejected',
        'email_change_requested',
        'email_changed',
        'account_deletion_cancelled',
        'workspace_ownership_transfer',
        'mfa_enabled',
        'mfa_reconfigured',
        'mfa_recovery_codes_regenerated',
        'mfa_disabled',
        'api_token_created',
        'workspace_deleted',
    ];

    public static function isCurrent(object $row): bool
    {
        $kind = (string) $row->kind;
        $type = is_string($row->resource_type) ? $row->resource_type : null;
        $id = is_string($row->resource_id) ? $row->resource_id : null;
        $generation = is_string($row->resource_generation) ? $row->resource_generation : null;

        if ($type === null) {
            return in_array($kind, self::SAFE_NOTIFICATIONS, true);
        }
        if ($id === null || $generation === null || ! self::validHash($generation)) {
            return false;
        }

        return match ($type) {
            'email_token' => self::emailToken($kind, $id, $generation),
            'email_change' => self::emailChange($kind, $id, $generation),
            'invitation' => self::invitation($kind, $id, $generation),
            'data_export' => self::dataExport($kind, $id, $generation),
            'account_deletion' => self::accountDeletion($kind, $id, $generation),
            'account_recovery' => self::accountRecovery($kind, $id, $generation),
            'privacy_right' => self::privacyRight($kind, $id, $generation),
            default => false,
        };
    }

    private static function emailToken(string $kind, string $id, string $generation): bool
    {
        $tokenKind = match ($kind) {
            'verification' => 'verify',
            'password_reset' => 'reset',
            'password_changed' => 'security_revoke',
            default => null,
        };
        if ($tokenKind === null || ! self::validHash($id) || ! hash_equals($id, $generation)) {
            return false;
        }

        $query = DB::table('email_tokens as t')
            ->join('users as u', 'u.id', '=', 't.user_id')
            ->where('t.id', $id)
            ->where('t.kind', $tokenKind)
            ->whereNull('t.used_at')
            ->where('t.expires_at', '>', now());

        if ($tokenKind === 'verify') {
            return $query->whereNull('u.deleted_at')->whereNull('u.email_verified_at')->exists();
        }
        if ($tokenKind === 'reset') {
            return $query->whereNull('u.deleted_at')->whereNotNull('u.email_verified_at')->exists();
        }

        // Emergency revocation intentionally survives the seven-day account
        // deletion grace period so a hostile deletion can still be stopped.
        return $query->whereNotNull('u.email_verified_at')->exists();
    }

    private static function emailChange(string $kind, string $id, string $generation): bool
    {
        if ($kind !== 'email_change_verification' || ! self::validHash($id) || ! hash_equals($id, $generation)) {
            return false;
        }

        return DB::table('email_change_requests as r')
            ->join('users as u', 'u.id', '=', 'r.user_id')
            ->where('r.id', $id)
            ->where('r.expires_at', '>', now())
            ->whereColumn('r.security_version', 'u.security_version')
            ->whereNull('u.deleted_at')
            ->whereNotNull('u.email_verified_at')
            ->exists();
    }

    private static function invitation(string $kind, string $id, string $generation): bool
    {
        $numericId = self::numericId($id);
        if ($kind !== 'invitation' || $numericId === null) {
            return false;
        }

        return DB::table('invitations as i')
            ->join('users as u', 'u.id', '=', 'i.invited_by')
            ->join('memberships as m', function ($join) {
                $join->on('m.workspace_id', '=', 'i.workspace_id')
                    ->on('m.user_id', '=', 'i.invited_by');
            })
            ->where('i.id', $numericId)
            ->where('i.status', 'pending')->where('i.expires_at', '>', now())
            ->where('i.token', $generation)
            ->whereNull('u.deleted_at')
            ->whereNotNull('u.email_verified_at')
            ->where(function ($authority) {
                $authority->where(function ($adminInvite) {
                    $adminInvite->where('i.role', 'admin')->where('m.role', 'owner');
                })->orWhere(function ($memberInvite) {
                    $memberInvite->whereIn('i.role', ['editor', 'viewer'])
                        ->whereIn('m.role', ['owner', 'admin']);
                });
            })
            ->exists();
    }

    private static function dataExport(string $kind, string $id, string $generation): bool
    {
        $numericId = self::numericId($id);
        $state = match ($kind) {
            'data_export_confirmation' => ['requested', 'confirmation_token_hash', 'confirmation_expires_at'],
            'data_export_ready' => ['ready', 'download_token_hash', 'download_expires_at'],
            default => null,
        };
        if ($numericId === null || $state === null) {
            return false;
        }

        return DB::table('data_export_requests as r')
            ->join('users as u', 'u.id', '=', 'r.user_id')
            ->where('r.id', $numericId)->where('r.status', $state[0])
            ->where('r.'.$state[1], $generation)->where('r.'.$state[2], '>', now())
            ->whereColumn('r.security_version', 'u.security_version')
            ->whereNull('u.deleted_at')->exists();
    }

    private static function accountDeletion(string $kind, string $id, string $generation): bool
    {
        $numericId = self::numericId($id);
        if ($numericId === null) {
            return false;
        }
        if ($kind === 'account_deletion_confirmation') {
            return DB::table('account_deletion_requests as r')
                ->join('users as u', 'u.id', '=', 'r.user_id')
                ->where('r.id', $numericId)
                ->where('r.status', 'requested')->where('r.confirmation_token_hash', $generation)
                ->where('r.confirmation_expires_at', '>', now())
                ->whereColumn('r.security_version', 'u.security_version')
                ->whereNull('u.deleted_at')->where('u.is_admin', false)
                ->exists();
        }
        if ($kind === 'account_deletion_scheduled') {
            return DB::table('account_deletion_requests')->where('id', $numericId)
                ->where('status', 'scheduled')->where('cancel_token_hash', $generation)
                ->where('execute_after', '>', now())->exists();
        }

        return false;
    }

    private static function accountRecovery(string $kind, string $id, string $generation): bool
    {
        $numericId = self::numericId($id);
        $state = match ($kind) {
            'account_recovery_confirmation' => ['requested', 'confirmation_token_hash', 'confirmation_expires_at'],
            'account_recovery_approved' => ['approved', 'completion_token_hash', 'completion_expires_at'],
            default => null,
        };
        if ($numericId === null || $state === null) {
            return false;
        }

        return DB::table('account_recovery_requests as r')
            ->join('users as u', 'u.id', '=', 'r.user_id')
            ->where('r.id', $numericId)->where('r.status', $state[0])
            ->where('r.'.$state[1], $generation)->where('r.'.$state[2], '>', now())
            ->where('r.expires_at', '>', now())
            ->whereColumn('r.security_version', 'u.security_version')
            ->whereNull('u.deleted_at')->whereNotNull('u.email_verified_at')->exists();
    }

    private static function privacyRight(string $kind, string $id, string $generation): bool
    {
        $numericId = self::numericId($id);
        if ($numericId === null || ! in_array($kind, ['privacy_request_received', 'privacy_request_updated'], true)) {
            return false;
        }

        return DB::table('privacy_rights_requests as r')
            ->join('users as u', 'u.id', '=', 'r.user_id')
            ->where('r.id', $numericId)
            ->where('r.generation_hash', $generation)
            ->whereNull('u.deleted_at')
            ->whereNotNull('u.email_verified_at')
            ->exists();
    }

    private static function validHash(string $value): bool
    {
        return preg_match('/^[a-f0-9]{64}$/D', $value) === 1;
    }

    private static function numericId(string $value): ?int
    {
        if (preg_match('/^[1-9][0-9]*$/D', $value) !== 1) {
            return null;
        }
        $id = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return is_int($id) ? $id : null;
    }
}
