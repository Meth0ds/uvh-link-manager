<?php

namespace App\Support;

use App\Models\User;
use App\Models\UvhSession;
use Illuminate\Support\Facades\DB;

/**
 * An account and its exact live session revalidated under row locks.
 * Use only inside the transaction that created it: readonly does not make
 * Eloquent models immutable or extend the lifetime of database locks.
 */
final readonly class SecurityContext
{
    /** @param array<int, User> $lockedUsers */
    private function __construct(
        public User $user,
        public UvhSession $session,
        private array $lockedUsers,
    ) {}

    public static function lock(User $snapshot, ?string $sessionId, bool $requireVerifiedEmail = false): ?self
    {
        self::requireTransaction();
        $account = User::where('id', $snapshot->id)->whereNull('deleted_at')->lockForUpdate()->first();

        return self::fromLockedUsers($snapshot, $sessionId, $account ? [(int) $account->id => $account] : [], $requireVerifiedEmail);
    }

    /**
     * Lock all participating users before the actor's session. Callers retain
     * their own eligibility checks for each related user and resource.
     *
     * @param  list<mixed>  $relatedUserIds
     */
    public static function lockWithUsers(User $snapshot, ?string $sessionId, array $relatedUserIds, bool $requireVerifiedEmail = false): ?self
    {
        self::requireTransaction();
        $ids = [(int) $snapshot->id];
        foreach ($relatedUserIds as $id) {
            if (! is_int($id) || $id < 1) {
                throw new \InvalidArgumentException('Related account IDs must be positive integers');
            }
            $ids[] = $id;
        }
        $ids = array_values(array_unique($ids));
        sort($ids, SORT_NUMERIC);
        $users = User::whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get()->keyBy('id');

        return self::fromLockedUsers($snapshot, $sessionId, $users->all(), $requireVerifiedEmail);
    }

    public function relatedUser(int $id): ?User
    {
        return $this->lockedUsers[$id] ?? null;
    }

    /** @param array<int, User> $users */
    private static function fromLockedUsers(User $snapshot, ?string $sessionId, array $users, bool $requireVerifiedEmail): ?self
    {
        $account = $users[(int) $snapshot->id] ?? null;
        if (! $account || $account->deleted_at || ($requireVerifiedEmail && ! $account->email_verified_at)
            || (int) $account->security_version !== (int) $snapshot->security_version || $sessionId === null) {
            return null;
        }
        $session = UvhSession::where('id', $sessionId)->where('user_id', $account->id)
            ->whereNull('revoked_at')->where('expires_at', '>', now())->lockForUpdate()->first();
        if (! $session || (int) $session->security_version !== (int) $account->security_version) {
            return null;
        }

        return new self($account, $session, $users);
    }

    private static function requireTransaction(): void
    {
        if (DB::transactionLevel() < 1) {
            throw new \LogicException('A locked security context requires an active transaction');
        }
    }
}
