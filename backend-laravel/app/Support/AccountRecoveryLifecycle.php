<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

final class AccountRecoveryLifecycle
{
    private const ACTIVE_STATUSES = ['requested', 'email_confirmed', 'in_review', 'approved'];

    /**
     * Cancel every bearer and approval for a live recovery case.
     *
     * Callers must already hold the owning users row lock and be inside the
     * transaction that changes the account security state. Recovery endpoints
     * follow the same users-first lock order, so cancellation cannot race a
     * concurrent approval or completion into a usable stale bearer.
     */
    public static function cancelActiveForUser(int $userId, mixed $at = null): int
    {
        $requestIds = DB::table('account_recovery_requests')
            ->where('user_id', $userId)
            ->whereIn('status', self::ACTIVE_STATUSES)
            ->orderBy('id')
            ->pluck('id');
        if ($requestIds->isEmpty()) {
            return 0;
        }

        $now = $at ?? now();
        DB::table('account_recovery_approvals')->whereIn('request_id', $requestIds)->delete();

        return DB::table('account_recovery_requests')
            ->whereIn('id', $requestIds)
            ->whereIn('status', self::ACTIVE_STATUSES)
            ->update([
                'status' => 'cancelled',
                'confirmation_token_hash' => null,
                'confirmation_expires_at' => null,
                'completion_token_hash' => null,
                'completion_expires_at' => null,
                'updated_at' => $now,
            ]);
    }
}
