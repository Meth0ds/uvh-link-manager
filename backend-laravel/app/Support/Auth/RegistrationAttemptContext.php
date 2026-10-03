<?php

namespace App\Support\Auth;

use App\Models\PendingRegistration;
use App\Models\RegistrationAttempt;
use App\Support\RegistrationEdit;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/** Browser context resolution and the common lifecycle lock order. */
final class RegistrationAttemptContext
{
    public static function owns(Request $request, string $email): bool
    {
        $attempt = self::snapshot($request, $email);
        if (! $attempt) {
            return false;
        }

        return DB::transaction(function () use ($request, $attempt, $email): bool {
            $locked = self::lock($attempt);

            return $locked !== null && self::authorizes($request, $locked, $email);
        });
    }

    public static function purgeExpired(string $cutoff, int $batch): void
    {
        $batch = max(1, min(1000, $batch));
        for ($pass = 0; $pass < 10; $pass++) {
            // The inner SELECT may see an expired row whose renewal has not
            // committed yet. DELETE must recheck the live expiry after waiting
            // for its lock, instead of deleting by the stale list of IDs alone.
            $deleted = DB::delete('DELETE FROM registration_attempts WHERE expires_at < ? AND id IN (SELECT id FROM registration_attempts WHERE expires_at < ? ORDER BY id LIMIT '.$batch.')', [$cutoff, $cutoff]);
            if ($deleted < $batch) {
                return;
            }
        }
    }

    public static function snapshot(Request $request, string $email): ?RegistrationAttempt
    {
        $claim = RegistrationEdit::claim($request);
        if ($claim === null) {
            return null;
        }
        if ($claim['v'] === 4) {
            $attempt = RegistrationAttempt::find($claim['pid']);
        } else {
            // Upgrade an authentic legacy witness once, under the same mutex
            // used by activation. A legacy decoy owns only its chosen browser
            // context; it can never attach somebody else's pending row.
            $attempt = DB::transaction(function () use ($claim, $request, $email): ?RegistrationAttempt {
                self::mutex($claim['pid'] > 0 ? 'pending:'.$claim['pid'] : 'legacy:'.$claim['digest']);
                $attempt = $claim['pid'] > 0
                    ? RegistrationAttempt::where('legacy_pending_id', $claim['pid'])->first()
                    : RegistrationAttempt::where('legacy_claim_hash', $claim['digest'])->first();
                if ($attempt) {
                    return $attempt;
                }
                $pending = $claim['pid'] > 0
                    ? PendingRegistration::whereKey($claim['pid'])->lockForUpdate()->first()
                    : null;
                if ($claim['pid'] > 0 && (! $pending || ! RegistrationEdit::authorizes($request, $pending)
                    || strtolower((string) $pending->email) !== $email
                    || RegistrationAttempt::where('pending_registration_id', $pending->id)->exists())) {
                    return null;
                }
                if ($claim['pid'] === 0 && $claim['sv'] !== 0) {
                    return null;
                }

                return RegistrationAttempt::create([
                    'email' => $email,
                    'expires_at' => Carbon::createFromTimestampMs($claim['e']),
                    'pending_registration_id' => $pending?->id,
                    'pending_security_version' => $pending?->security_version,
                    'legacy_pending_id' => $pending?->id,
                    'legacy_security_version' => $pending?->security_version,
                    'legacy_claim_hash' => $pending ? null : $claim['digest'],
                ]);
            });
        }

        return $attempt && self::authorizes($request, $attempt, $email) ? $attempt : null;
    }

    public static function authorizes(Request $request, RegistrationAttempt $attempt, string $email): bool
    {
        return strtolower((string) $attempt->email) === $email && RegistrationEdit::authorizesAttempt($request, $attempt);
    }

    /** Call inside a transaction, before taking any context/pending/token lock. */
    public static function lock(RegistrationAttempt $snapshot): ?RegistrationAttempt
    {
        self::mutex(self::root($snapshot));

        return RegistrationAttempt::whereKey($snapshot->id)->lockForUpdate()->first();
    }

    /** Lock child before parent: ON DELETE SET NULL also updates the child. */
    public static function lockForPending(int $pendingId): ?RegistrationAttempt
    {
        $snapshot = RegistrationAttempt::where('pending_registration_id', $pendingId)->first();
        if (! $snapshot) {
            self::mutex('pending:'.$pendingId);
            // A legacy upgrade may have committed while we waited.
            $snapshot = RegistrationAttempt::where('pending_registration_id', $pendingId)->first();
        }

        return $snapshot ? self::lock($snapshot) : null;
    }

    private static function root(RegistrationAttempt $attempt): string
    {
        // Immutable lineage: activation/recreation never changes this root.
        // A virtual context stays in the attempt namespace after attaching a
        // newly created pending row; its legacy_pending_id remains NULL.
        if ($attempt->legacy_pending_id !== null) {
            return 'pending:'.$attempt->legacy_pending_id;
        }
        if (is_string($attempt->legacy_claim_hash)) {
            return 'legacy:'.$attempt->legacy_claim_hash;
        }

        return 'attempt:'.$attempt->id;
    }

    private static function mutex(string $root): void
    {
        // Separate PostgreSQL two-integer namespace from email's bigint locks.
        // Hash collisions only serialize unrelated registration contexts.
        DB::select('SELECT pg_advisory_xact_lock(829104, hashtext(?))', [$root]);
    }
}
