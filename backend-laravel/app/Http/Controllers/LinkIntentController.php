<?php

namespace App\Http\Controllers;

use App\Support\Ids;
use App\Support\LinkIntentRegistry;
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
    private const TTL_HOURS = 24;
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
        $expiresAt = now()->addHours(self::TTL_HOURS);
        $counterBaseKey = $this->counterKey((string) ($request->ip() ?? ''));
        $bucketAt = now()->startOfHour();
        $counterKey = $this->counterBucketKey($counterBaseKey, $bucketAt);
        $globalCounterKey = $this->counterBucketKey($this->globalCounterKey(), $bucketAt);
        $ipCounterIncremented = false;
        $globalCounterIncremented = false;
        try {
            $accepted = $this->withCounterLocks($counterBaseKey, function () use ($counterBaseKey, $counterKey, $globalCounterKey, $bucketAt, &$ipCounterIncremented, &$globalCounterIncremented): bool {
                $active = $this->bucketTotal($counterBaseKey, $bucketAt);
                $global = $this->bucketTotal($this->globalCounterKey(), $bucketAt);
                if ($active >= self::MAX_ACTIVE_PER_IP || $global >= self::MAX_ACTIVE_GLOBAL) {
                    return false;
                }
                // Buckets keep rolling-window admission bounded without a shared
                // TTL that can be extended indefinitely by newer intentions.
                if (! Cache::put($counterKey, (int) Cache::get($counterKey, 0) + 1, now()->addHours(self::TTL_HOURS + 2))) {
                    throw new \RuntimeException('Intent IP counter rejected write');
                }
                $ipCounterIncremented = true;
                if (! Cache::put($globalCounterKey, (int) Cache::get($globalCounterKey, 0) + 1, now()->addHours(self::TTL_HOURS + 2))) {
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
        $intent = $this->intentFrom($request);
        $user = UvhRequest::user($request);
        if ($intent === null || $user === null) {
            return $this->unavailable();
        }

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
            return $this->unavailable();
        }

        return response()->json([
            'destination' => $record['destination'],
            'expiresAt' => $record['expires_at'],
        ]);
    }

    public function complete(Request $request)
    {
        $intent = $this->intentFrom($request);
        $user = UvhRequest::user($request);
        if ($intent === null || $user === null) {
            return $this->unavailable();
        }

        $intentHash = Ids::sha256Hex($intent);
        try {
            $completed = $this->withLock($intent, function () use ($intent, $intentHash, $user): bool {
                $record = Cache::get($this->cacheKey($intent));
                if (! $this->validRecord($record) || (int) $record['claimed_by'] !== $user->id) {
                    return false;
                }

                LinkIntentRegistry::forget($intentHash);
                Cache::forget($this->cacheKey($intent));
                if (is_string($record['counter_key'] ?? null)) {
                    $counterLockKey = is_string($record['counter_lock_key'] ?? null)
                        ? $record['counter_lock_key']
                        : $record['counter_key'];
                    $this->withCounterLocks($counterLockKey, function () use ($record): bool {
                        $active = max(0, (int) Cache::get($record['counter_key'], 0) - 1);
                        $globalKey = is_string($record['global_counter_key'] ?? null)
                            ? $record['global_counter_key']
                            : $this->globalCounterKey();
                        $global = max(0, (int) Cache::get($globalKey, 0) - 1);
                        Cache::put($record['counter_key'], $active, now()->addHours(self::TTL_HOURS));
                        Cache::put($globalKey, $global, now()->addHours(self::TTL_HOURS));
                        return true;
                    });
                }
                return true;
            });
        } catch (\Throwable) {
            return $this->temporarilyUnavailable();
        }

        return $completed ? response()->json(['ok' => true]) : $this->unavailable();
    }

    private function intentFrom(Request $request): ?string
    {
        $intent = $request->input('intent');
        if (! is_string($intent) || ! preg_match('/^[A-Za-z0-9_-]{43}$/D', $intent)) {
            return null;
        }

        return $intent;
    }

    /**
     * @param mixed $record
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
     * @param callable(): T $callback
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
        for ($offset = 0; $offset <= self::TTL_HOURS; $offset++) {
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
    ): void
    {
        try {
            $this->withCounterLocks($counterBaseKey, function () use ($counterKey, $globalCounterKey, $decrementIp, $decrementGlobal): bool {
                if ($decrementIp) {
                    Cache::put($counterKey, max(0, (int) Cache::get($counterKey, 0) - 1), now()->addHours(self::TTL_HOURS + 2));
                }
                if ($decrementGlobal) {
                    Cache::put($globalCounterKey, max(0, (int) Cache::get($globalCounterKey, 0) - 1), now()->addHours(self::TTL_HOURS + 2));
                }
                return true;
            });
        } catch (\Throwable) {
            // Buckets have a bounded TTL. Preserve the original service error
            // instead of replacing it with a cleanup exception.
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
