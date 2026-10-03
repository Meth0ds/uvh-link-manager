<?php

namespace App\Support\Auth;

use App\Models\User;
use App\Support\Audit;
use App\Support\SecurityContext;
use Illuminate\Support\Facades\DB;

/** Complete transactions for explicit session revocation and its durable notice. */
final class SessionRevocationAdmission
{
    public static function revoke(User $user, ?string $currentId, string $id): bool
    {
        return DB::transaction(function () use ($user, $id, $currentId): bool {
            $account = SecurityContext::lock($user, $currentId)?->user;
            if (! $account) {
                return false;
            }
            $row = $account->sessions()->where('id', $id)->lockForUpdate()->first();
            if (! $row) {
                return false;
            }
            if (! $row->revoked_at) {
                $row->update(['revoked_at' => now()]);
                SecurityIncidentNotice::sessionRevoked($account);
                Audit::write($account->id, 'auth.session_revoke', 'session', $id);
            }

            return true;
        });
    }

    public static function others(User $user, ?string $currentId): int
    {
        return DB::transaction(function () use ($user, $currentId): int {
            $account = SecurityContext::lock($user, $currentId)?->user;
            if (! $account) {
                return -1;
            }
            $revoked = $account->sessions()->where('id', '!=', $currentId)
                ->whereNull('revoked_at')->update(['revoked_at' => now()]);
            if ($revoked > 0) {
                SecurityIncidentNotice::sessionsRevoked($account, false);
            }
            Audit::write($account->id, 'auth.sessions_revoked_others', 'user', $account->id, ['revoked' => $revoked]);

            return $revoked;
        });
    }

    public static function all(User $user, ?string $currentId): int
    {
        return DB::transaction(function () use ($user, $currentId): int {
            $account = SecurityContext::lock($user, $currentId)?->user;
            if (! $account) {
                return -1;
            }
            $revoked = $account->sessions()->whereNull('revoked_at')->update(['revoked_at' => now()]);
            if ($revoked > 0) {
                SecurityIncidentNotice::sessionsRevoked($account, true);
            }
            Audit::write($account->id, 'auth.sessions_revoked_all', 'user', $account->id, ['revoked' => $revoked]);

            return $revoked;
        });
    }
}
