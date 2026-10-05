<?php

namespace App\Support\Auth;

use App\Models\User;

/** Preflight lookup only; admission must revalidate account authority under lock. */
final class AuthAccountLookup
{
    public static function activeByEmail(string $email): ?User
    {
        return User::whereRaw('lower(email) = ?', [strtolower($email)])->whereNull('deleted_at')->first();
    }
}
