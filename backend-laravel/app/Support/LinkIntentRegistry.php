<?php

namespace App\Support;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** Metadata-only inverse index used to revoke claimed link intentions by user. */
class LinkIntentRegistry
{
    private const TTL_HOURS = 24;

    private const MAX_ACTIVE_PER_USER = 100;

    public static function remember(int $userId, string $intentHash, string $expiresAt): void
    {
        if (! preg_match('/^[a-f0-9]{64}$/D', $intentHash)) {
            throw new \InvalidArgumentException('Invalid link intent digest');
        }
        $expiry = Carbon::parse($expiresAt);
        if (! $expiry->isFuture()) {
            throw new \InvalidArgumentException('Expired link intent');
        }

        DB::transaction(function () use ($userId, $intentHash, $expiry): void {
            // The same account can claim from multiple browser requests. A
            // transaction-scoped advisory lock makes the per-user cap atomic.
            DB::select('SELECT pg_advisory_xact_lock(?, ?)', [0x555648, $userId % 2147483647]);
            DB::table('link_intent_claims')->where('user_id', $userId)
                ->where('expires_at', '<=', now())->delete();

            $existing = DB::table('link_intent_claims')->where('intent_hash', $intentHash)->first();
            if ($existing) {
                if ((int) $existing->user_id !== $userId) {
                    throw new \LogicException('Link intent digest ownership mismatch');
                }
                DB::table('link_intent_claims')->where('intent_hash', $intentHash)
                    ->update(['expires_at' => $expiry]);

                return;
            }
            if (DB::table('link_intent_claims')->where('user_id', $userId)->count() >= self::MAX_ACTIVE_PER_USER) {
                throw new \OverflowException('Too many claimed link intents');
            }
            DB::table('link_intent_claims')->insert([
                'intent_hash' => $intentHash,
                'user_id' => $userId,
                'expires_at' => $expiry,
                'created_at' => now(),
            ]);
        });
    }

    public static function forget(string $intentHash): void
    {
        DB::table('link_intent_claims')->where('intent_hash', $intentHash)->delete();
    }

    /** @return array{revoked: int, busy: int} */
    public static function revokeForUser(int $userId): array
    {
        $rows = DB::table('link_intent_claims')->where('user_id', $userId)
            ->orderBy('intent_hash')->limit(1000)->get(['intent_hash']);
        $revoked = 0;
        $busy = 0;

        foreach ($rows as $row) {
            $intentHash = (string) $row->intent_hash;
            try {
                $lock = Cache::lock('link-intent-lock:'.$intentHash, 5);
                if (! $lock->get()) {
                    $busy++;

                    continue;
                }
            } catch (\Throwable) {
                $busy++;

                continue;
            }

            try {
                try {
                    $record = Cache::get('link-intent:'.$intentHash);
                    if (is_array($record) && (int) ($record['claimed_by'] ?? 0) === $userId) {
                        if (! Cache::forget('link-intent:'.$intentHash)) {
                            // Retain the inverse index so a later security or
                            // housekeeping pass can retry the revocation.
                            $busy++;

                            continue;
                        }
                        self::releaseCounters($record);
                        $revoked++;
                    }
                    self::forget($intentHash);
                } catch (\Throwable) {
                    // One unavailable cache entry must not prevent revocation
                    // of the remaining handoffs in this bounded batch.
                    $busy++;
                }
            } finally {
                try {
                    $lock->release();
                } catch (\Throwable) {
                    // The five-second lease bounds stale ownership. Revocation
                    // state above remains authoritative after a release error.
                    OperationalMetrics::increment('lock.unavailable');
                }
            }
        }

        return ['revoked' => $revoked, 'busy' => $busy];
    }

    public static function purgeExpired(): int
    {
        return DB::table('link_intent_claims')->where('expires_at', '<=', now())->delete();
    }

    /** @param array<string, mixed> $record */
    private static function releaseCounters(array $record): void
    {
        $counterKey = $record['counter_key'] ?? null;
        if (! is_string($counterKey) || $counterKey === '') {
            return;
        }
        $counterLockKey = is_string($record['counter_lock_key'] ?? null)
            ? $record['counter_lock_key']
            : $counterKey;
        $globalKey = is_string($record['global_counter_key'] ?? null)
            ? $record['global_counter_key']
            : 'link-intent-active:global';

        $globalLock = Cache::lock('link-intent-active:global:lock', 5);
        if (! $globalLock->get()) {
            return;
        }
        $counterLock = Cache::lock($counterLockKey.':lock', 5);
        if (! $counterLock->get()) {
            $globalLock->release();

            return;
        }

        try {
            Cache::put($counterKey, max(0, (int) Cache::get($counterKey, 0) - 1), now()->addHours(self::TTL_HOURS));
            Cache::put($globalKey, max(0, (int) Cache::get($globalKey, 0) - 1), now()->addHours(self::TTL_HOURS));
        } finally {
            $counterLock->release();
            $globalLock->release();
        }
    }
}
