<?php

namespace App\Support\Auth;

use App\Models\User;
use App\Support\Audit;
use App\Support\IsoDate;
use App\Support\RequestTrace;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/** Recoverable evidence without making the general audit outbox gate protection. */
final class SecurityIncidentAudit
{
    /** Caller holds the account lock in the transaction consuming the incident. */
    public static function record(User $lockedUser, bool $administrativelyBlocked): void
    {
        if (DB::transactionLevel() < 1) {
            throw new \LogicException('Protective incident receipt requires the mutation transaction');
        }
        $receipt = [
            'user_id' => (int) $lockedUser->id,
            'affected_user_id' => (int) $lockedUser->id,
            'administratively_blocked' => $administrativelyBlocked,
            'incident_correlation_id' => RequestTrace::current(),
            'incident_at' => IsoDate::format(now()),
        ];
        $receipt['id'] = DB::table('security_incident_audits')->insertGetId($receipt);
        self::admit((object) $receipt);
    }

    /** Account before receipt; a bounded pass never destroys unresolved evidence. */
    public static function reconcile(): void
    {
        $candidates = DB::table('security_incident_audits')->orderBy('id')->limit(100)->get(['id', 'user_id']);
        foreach ($candidates as $candidate) {
            $admitted = DB::transaction(static function () use ($candidate): bool {
                if ($candidate->user_id !== null) {
                    User::where('id', $candidate->user_id)->lockForUpdate()->first();
                }
                $receipt = DB::table('security_incident_audits')->where('id', $candidate->id)->lockForUpdate()->first();

                return $receipt === null || self::admit($receipt);
            });
            if (! $admitted) {
                throw new \RuntimeException('Protective incident audit admission unavailable');
            }
        }
    }

    private static function admit(\stdClass $receipt): bool
    {
        try {
            // The savepoint also contains SQL failures. Receipt deletion and
            // durable admission commit together; history delivery is deferred.
            DB::transaction(static function () use ($receipt): void {
                $metadata = [
                    'administratively_blocked' => (bool) $receipt->administratively_blocked,
                    'incident_at' => IsoDate::format($receipt->incident_at),
                ];
                if ($receipt->incident_correlation_id !== null) {
                    $metadata['incident_correlation_id'] = (string) $receipt->incident_correlation_id;
                }
                Audit::write(
                    $receipt->user_id === null ? null : (int) $receipt->user_id,
                    'auth.emergency_access_revoked',
                    'user',
                    (int) $receipt->affected_user_id,
                    $metadata,
                );
                DB::table('security_incident_audits')->where('id', $receipt->id)->delete();
            });

            return true;
        } catch (\Throwable $error) {
            try {
                Log::warning('Protective incident audit remains pending', [
                    'receipt_id' => (int) $receipt->id, 'exception_class' => $error::class,
                ]);
            } catch (\Throwable) {
                // A broken fallback transport cannot roll back protection.
            }

            return false;
        }
    }
}
