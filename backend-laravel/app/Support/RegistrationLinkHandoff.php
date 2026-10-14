<?php

namespace App\Support;

use App\Models\PendingRegistration;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/** Carries an existing hero intent through registration without creating a link. */
final class RegistrationLinkHandoff
{
    public static function capture(PendingRegistration $pending, Request $request): void
    {
        if (DB::table('registration_link_handoffs')->where('pending_registration_id', $pending->id)->exists()) {
            return;
        }
        $token = PendingHandoff::bearer($request, PendingHandoff::INTENT);
        if ($token === null) {
            return;
        }
        $hash = Ids::sha256Hex($token);
        $record = Cache::get('link-intent:'.$hash);
        if (! is_array($record) || ($record['claimed_by'] ?? null) !== null
            || ! is_string($record['destination'] ?? null) || ! is_string($record['expires_at'] ?? null)) {
            return;
        }
        $expiry = IsoDate::parse($record['expires_at']);
        if ($expiry === null || ! $expiry->isFuture()) {
            return;
        }
        $cookieExpiry = IsoDate::parse(PendingHandoff::expiresAt($request, PendingHandoff::INTENT) ?? '');
        if ($cookieExpiry !== null && $cookieExpiry->lt($expiry)) {
            $expiry = $cookieExpiry;
        }
        DB::table('registration_link_handoffs')->insert([
            'pending_registration_id' => $pending->id, 'intent_hash' => $hash,
            'encrypted_token' => Crypt::encryptString($token),
            'expires_at' => $expiry, 'created_at' => now(),
        ]);
    }

    /** Called inside activation's transaction, before deleting its pending row. */
    public static function bind(PendingRegistration $pending, User $user): bool
    {
        $row = DB::table('registration_link_handoffs')->where('pending_registration_id', $pending->id)->lockForUpdate()->first();
        if (! $row || Carbon::parse($row->expires_at)->lte(now())) {
            return false;
        }
        try {
            LinkIntentRegistry::remember($user->id, $row->intent_hash, Carbon::parse($row->expires_at)->toIso8601String());
        } catch (\LogicException|\OverflowException) {
            // An unavailable handoff cannot prevent creation of the account.
            return false;
        }
        DB::table('registration_link_handoffs')->where('id', $row->id)->update([
            'pending_registration_id' => null, 'user_id' => $user->id,
            'security_version' => (int) $user->security_version,
        ]);

        return true;
    }

    /** @return array{token: string, expiresAt: int}|null */
    public static function forUser(User $user): ?array
    {
        $row = DB::table('registration_link_handoffs')->where('user_id', $user->id)
            ->where('security_version', (int) $user->security_version)->where('expires_at', '>', now())->first();
        if (! $row || ! DB::table('link_intent_claims')->where('intent_hash', $row->intent_hash)->where('user_id', $user->id)->exists()) {
            return null;
        }
        try {
            $token = Crypt::decryptString($row->encrypted_token);
        } catch (\Throwable) {
            return null;
        }
        if (! PendingHandoff::accepts($token)) {
            return null;
        }
        try {
            $record = Cache::get('link-intent:'.$row->intent_hash);
        } catch (\Throwable) {
            return null;
        }
        $expiry = is_array($record) && is_string($record['expires_at'] ?? null) ? IsoDate::parse($record['expires_at']) : null;
        if (! is_array($record) || $expiry === null || ! $expiry->isFuture()
            || (($record['claimed_by'] ?? null) !== null && (int) $record['claimed_by'] !== $user->id)) {
            DB::table('registration_link_handoffs')->where('id', $row->id)->delete();

            return null;
        }

        return ['token' => $token, 'expiresAt' => Carbon::parse($row->expires_at)->getTimestamp()];
    }

    /** Enforce durable ownership even before the cached record has been claimed. */
    public static function permits(string $intentHash, User $user): bool
    {
        $assigned = DB::table('link_intent_claims')->where('intent_hash', $intentHash)->first();
        if ($assigned && (int) $assigned->user_id !== $user->id) {
            return false;
        }
        $rows = DB::table('registration_link_handoffs')->where('intent_hash', $intentHash)->whereNotNull('user_id')->get();
        foreach ($rows as $row) {
            if ((int) $row->user_id !== $user->id || (int) $row->security_version !== (int) $user->security_version || ! $assigned) {
                return false;
            }
        }

        return true;
    }
}
