<?php

namespace App\Support\Auth;

use App\Models\User;
use App\Support\Audit;
use App\Support\SecurityContext;
use Illuminate\Support\Facades\DB;

/** Complete transaction for the authenticated account profile. */
final class ProfileAdmission
{
    public static function update(User $user, ?string $sessionId, string $name): ?User
    {
        return DB::transaction(function () use ($user, $sessionId, $name): ?User {
            $context = SecurityContext::lock($user, $sessionId, true);
            if ($context === null) {
                return null;
            }
            $locked = $context->user;
            $locked->update(['name' => $name, 'updated_at' => now()]);
            Audit::write($locked->id, 'auth.profile_update', 'user', $locked->id);

            return $locked;
        });
    }
}
