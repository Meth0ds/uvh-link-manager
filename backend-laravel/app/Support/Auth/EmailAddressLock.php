<?php

namespace App\Support\Auth;

use Illuminate\Support\Facades\DB;

final class EmailAddressLock
{
    /**
     * Serialize claims across users, pending registrations and pending
     * email-change reservations.
     * Call only inside the caller's open transaction: the PostgreSQL lock
     * belongs to that transaction, not to this method's lifetime.
     *
     * This mutex serializes one destination, not all address changes. Callers
     * may still wait on row locks or unique indexes involving another address.
     * Email-change requests must reject a live foreign reservation before
     * deleting their own, so exchanging destinations cannot form a wait cycle.
     */
    public static function acquire(string $email): void
    {
        // A collision only causes harmless extra serialization. Using a
        // transaction-scoped PostgreSQL advisory lock closes the race between
        // registration and confirmation across two different tables.
        $key = (int) sprintf('%u', crc32('uvh:email:'.strtolower($email)));
        DB::select('SELECT pg_advisory_xact_lock(?)', [$key]);
    }
}
