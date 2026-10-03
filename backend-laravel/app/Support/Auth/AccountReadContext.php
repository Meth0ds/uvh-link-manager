<?php

namespace App\Support\Auth;

use App\Models\User;
use App\Models\UvhSession;

/**
 * Account/session snapshot for reads without mutation locks.
 * Readonly models are not immutable and this object grants no command authority.
 * Resolve afresh for each request; mutations must acquire SecurityContext.
 */
final readonly class AccountReadContext
{
    private function __construct(public User $user, public UvhSession $session) {}

    public static function resolve(?User $snapshot, ?string $sessionId): ?self
    {
        if ($snapshot === null || $sessionId === null) {
            return null;
        }
        $session = UvhSession::with('user')->where('id', $sessionId)
            ->where('user_id', $snapshot->id)
            ->where('security_version', (int) $snapshot->security_version)
            ->whereNull('revoked_at')->where('expires_at', '>', now())->first();
        $user = $session?->user;
        if (! $session || ! $user || $user->deleted_at || ! $user->email_verified_at
            || (int) $user->security_version !== (int) $snapshot->security_version) {
            return null;
        }

        return new self($user, $session);
    }
}
