<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\AccountDeletionActions;
use App\Http\Controllers\Concerns\AccountExportActions;
use App\Models\User;
use App\Models\UvhSession;

class AccountController
{
    use AccountDeletionActions;
    use AccountExportActions;

    /** Revalidate the verified middleware identity while holding account/session locks. */
    private function lockVerifiedActor(User $snapshot, ?string $sessionId): ?User
    {
        $account = User::where('id', $snapshot->id)->whereNull('deleted_at')->lockForUpdate()->first();
        if (! $account || ! $account->email_verified_at || $sessionId === null
            || (int) $account->security_version !== (int) $snapshot->security_version) {
            return null;
        }
        $session = UvhSession::where('id', $sessionId)->where('user_id', $account->id)
            ->whereNull('revoked_at')->where('expires_at', '>', now())->lockForUpdate()->first();
        if (! $session || (int) $session->security_version !== (int) $account->security_version) {
            return null;
        }

        return $account;
    }
}
