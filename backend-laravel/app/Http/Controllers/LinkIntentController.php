<?php

namespace App\Http\Controllers;

use App\Support\Ids;
use App\Support\LinkIntentRegistry;
use App\Support\OperationalMetrics;
use App\Support\PendingHandoff;
use App\Support\UrlUtil;
use App\Support\UvhRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;

/**
 * Short-lived, opaque handoff for a destination entered before authentication.
 *
 * The browser only carries the random intent token between public and app
 * hosts. The destination remains server-side until a verified user claims it.
 */
class LinkIntentController
{
    /** Shape of every intent this application issues: `Ids::randomToken(32)`. */
    private const INTENT_PATTERN = '/^[A-Za-z0-9_-]{43}$/D';

    private const MAX_ACTIVE_PER_IP = 20;

    private const MAX_ACTIVE_GLOBAL = 100_000;

    public function issue(Request $request)
    {
        $destination = trim(UvhRequest::inputString($request, 'destination'));
        $valid = UrlUtil::validateDestination($destination);
        if (! $valid['ok']) {
            return response()->json(['error' => $valid['error'] ?? 'URL inválida'], 422);
        }

        $intent = Ids::randomToken(32);
        $ttlHours = $this->ttlHours();
        $expiresAt = now()->addHours($ttlHours);
        $counterBaseKey = $this->counterKey((string) ($request->ip() ?? ''));
        $bucketAt = now()->startOfHour();
        $counterKey = $this->counterBucketKey($counterBaseKey, $bucketAt);
        $globalCounterKey = $this->counterBucketKey($this->globalCounterKey(), $bucketAt);
        $ipCounterIncremented = false;
        $globalCounterIncremented = false;
        try {
            $accepted = $this->withCounterLocks($counterBaseKey, function () use ($counterBaseKey, $counterKey, $globalCounterKey, $bucketAt, $ttlHours, &$ipCounterIncremented, &$globalCounterIncremented): bool {
                $active = $this->bucketTotal($counterBaseKey, $bucketAt);
                $global = $this->bucketTotal($this->globalCounterKey(), $bucketAt);
                if ($active >= self::MAX_ACTIVE_PER_IP || $global >= self::MAX_ACTIVE_GLOBAL) {
                    return false;
                }
                // Buckets keep rolling-window admission bounded without a shared
                // TTL that can be extended indefinitely by newer intentions.
                if (! Cache::put($counterKey, (int) Cache::get($counterKey, 0) + 1, now()->addHours($ttlHours + 2))) {
                    throw new \RuntimeException('Intent IP counter rejected write');
                }
                $ipCounterIncremented = true;
                if (! Cache::put($globalCounterKey, (int) Cache::get($globalCounterKey, 0) + 1, now()->addHours($ttlHours + 2))) {
                    throw new \RuntimeException('Intent global counter rejected write');
                }
                $globalCounterIncremented = true;

                return true;
            });
        } catch (\Throwable) {
            if ($ipCounterIncremented || $globalCounterIncremented) {
                $this->rollbackAdmission(
                    $counterBaseKey,
                    $counterKey,
                    $globalCounterKey,
                    $ipCounterIncremented,
                    $globalCounterIncremented,
                );
            }

            return $this->temporarilyUnavailable();
        }
        if (! $accepted) {
            return response()->json(['error' => 'Hay demasiadas URLs guardadas en este momento. Completa o descarta una antes de añadir otra.'], 429);
        }
        $record = [
            'destination' => $destination,
            'claimed_by' => null,
            'expires_at' => $expiresAt->toIso8601String(),
            'counter_key' => $counterKey,
            'counter_lock_key' => $counterBaseKey,
            'global_counter_key' => $globalCounterKey,
        ];
        try {
            if (! Cache::put($this->cacheKey($intent), $record, $expiresAt)) {
                throw new \RuntimeException('Intent store rejected write');
            }
        } catch (\Throwable) {
            $this->rollbackAdmission($counterBaseKey, $counterKey, $globalCounterKey, true, true);

            return $this->temporarilyUnavailable();
        }

        // Never include the destination in this public response: URLs often
        // contain campaign parameters that should not reach browser history.
        return response()->json([
            'intent' => $intent,
            'expiresAt' => $expiresAt->toIso8601String(),
        ], 201);
    }

    public function claim(Request $request)
    {
        $source = $this->intentSource($request);
        $user = UvhRequest::user($request);
        if ($source === null || $user === null) {
            return $this->unavailable();
        }
        $intent = $source['intent'];

        try {
            $record = $this->withLock($intent, function () use ($intent, $user): ?array {
                $record = Cache::get($this->cacheKey($intent));
                if (! $this->validRecord($record)) {
                    return null;
                }

                $claimedBy = $record['claimed_by'];
                if ($claimedBy !== null && (int) $claimedBy !== $user->id) {
                    return null;
                }

                if ($claimedBy === null) {
                    $record['claimed_by'] = $user->id;
                    if (! Cache::put($this->cacheKey($intent), $record, Carbon::parse($record['expires_at']))) {
                        return null;
                    }
                }

                try {
                    LinkIntentRegistry::remember($user->id, Ids::sha256Hex($intent), $record['expires_at']);
                } catch (\Throwable $e) {
                    if ($claimedBy === null) {
                        $record['claimed_by'] = null;
                        Cache::put($this->cacheKey($intent), $record, Carbon::parse($record['expires_at']));
                    }
                    throw $e;
                }

                return $record;
            });
        } catch (\OverflowException) {
            return response()->json(['error' => 'Tienes demasiadas URLs pendientes. Completa o descarta alguna antes de continuar.'], 429);
        } catch (\Throwable) {
            return response()->json(['error' => 'No se pudo recuperar la URL guardada. Inténtalo de nuevo más tarde.'], 503);
        }

        if ($record === null) {
            $missing = $this->unavailable();

            // Gone, expired or claimed by somebody else: none of those become
            // true on a retry, so a parked intent that reached this answer is a
            // dead end and its cookie goes with it. The 429 and 503 paths above
            // return earlier and deliberately leave it parked.
            return $source['parked'] ? PendingHandoff::clearOn($missing, PendingHandoff::INTENT) : $missing;
        }

        return response()->json([
            'destination' => $record['destination'],
            'expiresAt' => $record['expires_at'],
        ]);
    }

    public function complete(Request $request)
    {
        $source = $this->intentSource($request);
        $user = UvhRequest::user($request);
        if ($source === null || $user === null) {
            return $this->unavailable();
        }
        $intent = $source['intent'];

        $intentHash = Ids::sha256Hex($intent);
        try {
            $completed = $this->withLock($intent, function () use ($intent, $intentHash, $user): bool {
                $record = Cache::get($this->cacheKey($intent));
                if (! $this->validRecord($record) || (int) $record['claimed_by'] !== $user->id) {
                    return false;
                }

                if (! Cache::forget($this->cacheKey($intent))) {
                    // A false success would leave a reusable handoff after the
                    // browser was told it had been consumed. The inverse index
                    // is deliberately retained so revocation can still find it.
                    throw new \RuntimeException('Intent store rejected delete');
                }
                try {
                    LinkIntentRegistry::forget($intentHash);
                } catch (\Throwable) {
                    // The bearer is already gone and cannot be retried. Its
                    // metadata-only inverse row expires through housekeeping.
                    OperationalMetrics::increment('lock.unavailable');
                }
                $this->releaseConsumedIntentCounters($record);

                return true;
            });
        } catch (\Throwable) {
            return $this->temporarilyUnavailable();
        }

        $response = $completed ? response()->json(['ok' => true]) : $this->unavailable();

        // Same reasoning as `claim`: the record is gone either way, so a parked
        // cookie is spent. A body bearer belongs to the caller and is untouched.
        return $source['parked'] ? PendingHandoff::clearOn($response, PendingHandoff::INTENT) : $response;
    }

    /**
     * The intent this request carries, and where it came from.
     *
     * A body copy always wins when a client sends one — `POST /link-intents`
     * documents `intent` in the payload, and every consumer that is not this
     * panel uses it. When the body is empty the parked cookie is read instead:
     * the panel keeps no bearer in `localStorage`, so the authenticated calls
     * arrive without one.
     *
     * @return array{intent: string, parked: bool}|null
     */
    private function intentSource(Request $request): ?array
    {
        $body = $this->bodyIntent($request);
        if ($body !== null) {
            return ['intent' => $body, 'parked' => false];
        }

        $parked = PendingHandoff::bearer($request, PendingHandoff::INTENT);
        if ($parked === null) {
            return null;
        }

        return ['intent' => $parked, 'parked' => true];
    }

    private function bodyIntent(Request $request): ?string
    {
        $intent = $request->input('intent');
        if (! is_string($intent) || preg_match(self::INTENT_PATTERN, $intent) !== 1) {
            return null;
        }

        return $intent;
    }

    /** Hours an intent lives, and the ceiling of the cookie that parks it. */
    private function ttlHours(): int
    {
        return max(1, (int) config('uvh.intent_ttl_hours'));
    }

    /**
     * @param  mixed  $record
     */
    private function validRecord($record): bool
    {
        if (! is_array($record)
            || ! isset($record['destination'], $record['expires_at'])
            || ! is_string($record['destination'])
            || ! is_string($record['expires_at'])
            || ! array_key_exists('claimed_by', $record)) {
            return false;
        }

        try {
            return Carbon::parse($record['expires_at'])->isFuture();
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * @template T
     *
     * @param  callable(): T  $callback
     * @return T|null
     */
    private function withLock(string $intent, callable $callback)
    {
        try {
            $lock = Cache::lock($this->lockKey($intent), 5);
            if (! $lock->get()) {
                throw new \RuntimeException('Intent lock unavailable');
            }
        } catch (\Throwable $error) {
            throw new \RuntimeException('Intent lock unavailable', 0, $error);
        }

        try {
            return $callback();
        } finally {
            $lock->release();
        }
    }

    private function cacheKey(string $intent): string
    {
        return 'link-intent:'.Ids::sha256Hex($intent);
    }

    private function lockKey(string $intent): string
    {
        return 'link-intent-lock:'.Ids::sha256Hex($intent);
    }

    private function counterKey(string $ip): string
    {
        return 'link-intent-active:'.Ids::sha256Hex($ip);
    }

    private function globalCounterKey(): string
    {
        return 'link-intent-active:global';
    }

    private function counterBucketKey(string $base, Carbon $hour): string
    {
        return $base.':'.$hour->copy()->utc()->format('YmdH');
    }

    /** Count the current hour plus 24 prior buckets (conservative by < 1 h). */
    private function bucketTotal(string $base, Carbon $hour): int
    {
        $total = 0;
        for ($offset = 0; $offset <= $this->ttlHours(); $offset++) {
            $total += (int) Cache::get($this->counterBucketKey($base, $hour->copy()->subHours($offset)), 0);
        }

        return $total;
    }

    /**
     * Keep per-IP and global admission counters consistent. Every path takes
     * the global lock first, so completing an intent cannot deadlock with a
     * simultaneous issue from another IP.
     */
    private function withCounterLocks(string $key, callable $callback): mixed
    {
        $globalLock = Cache::lock($this->globalCounterKey().':lock', 5);
        if (! $globalLock->get()) {
            throw new \RuntimeException('Global intent counter lock unavailable');
        }

        $lock = Cache::lock($key.':lock', 5);
        if (! $lock->get()) {
            $globalLock->release();
            throw new \RuntimeException('Intent counter lock unavailable');
        }

        try {
            return $callback();
        } finally {
            $lock->release();
            $globalLock->release();
        }
    }

    private function rollbackAdmission(
        string $counterBaseKey,
        string $counterKey,
        string $globalCounterKey,
        bool $decrementIp,
        bool $decrementGlobal,
    ): void {
        try {
            $this->withCounterLocks($counterBaseKey, function () use ($counterKey, $globalCounterKey, $decrementIp, $decrementGlobal): bool {
                $ttlHours = $this->ttlHours();
                if ($decrementIp) {
                    Cache::put($counterKey, max(0, (int) Cache::get($counterKey, 0) - 1), now()->addHours($ttlHours + 2));
                }
                if ($decrementGlobal) {
                    Cache::put($globalCounterKey, max(0, (int) Cache::get($globalCounterKey, 0) - 1), now()->addHours($ttlHours + 2));
                }

                return true;
            });
        } catch (\Throwable) {
            // Buckets have a bounded TTL. Preserve the original service error
            // instead of replacing it with a cleanup exception.
        }
    }

    /** @param array<string, mixed> $record */
    private function releaseConsumedIntentCounters(array $record): void
    {
        if (! is_string($record['counter_key'] ?? null)) {
            return;
        }

        try {
            $counterLockKey = is_string($record['counter_lock_key'] ?? null)
                ? $record['counter_lock_key']
                : $record['counter_key'];
            $this->withCounterLocks($counterLockKey, function () use ($record): bool {
                $ttlHours = $this->ttlHours();
                $active = max(0, (int) Cache::get($record['counter_key'], 0) - 1);
                $globalKey = is_string($record['global_counter_key'] ?? null)
                    ? $record['global_counter_key']
                    : $this->globalCounterKey();
                $global = max(0, (int) Cache::get($globalKey, 0) - 1);
                if (! Cache::put($record['counter_key'], $active, now()->addHours($ttlHours))
                    || ! Cache::put($globalKey, $global, now()->addHours($ttlHours))) {
                    throw new \RuntimeException('Intent counter store rejected cleanup');
                }

                return true;
            });
        } catch (\Throwable) {
            // The handoff is already irreversibly consumed. Its hourly counter
            // buckets expire, so cleanup failure must not turn success into a
            // misleading 503 and cause clients to retry a deleted token.
            OperationalMetrics::increment('lock.unavailable');
        }
    }

    private function temporarilyUnavailable()
    {
        return response()->json([
            'error' => 'No se pudo acceder temporalmente a la URL guardada. Inténtalo de nuevo.',
        ], 503);
    }

    private function unavailable()
    {
        // Same response for expired, malformed, consumed and foreign intents.
        // It avoids using the endpoint as an oracle for valid handoff tokens.
        return response()->json(['error' => 'La URL guardada ya no está disponible'], 404);
    }
}
