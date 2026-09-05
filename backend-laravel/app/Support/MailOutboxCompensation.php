<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/** Durable, generation-aware recovery for lifecycle mail that never arrived. */
final class MailOutboxCompensation
{
    public static function attempt(int $outboxId): bool
    {
        $lockToken = Ids::sha256Hex(Ids::randomToken(32));
        try {
            $row = DB::transaction(function () use ($outboxId, $lockToken): ?object {
                $candidate = DB::table('mail_outbox')->where('id', $outboxId)
                    ->where('status', 'comp_pending')->where('available_at', '<=', now())
                    ->lockForUpdate()->first();
                if (! $candidate) {
                    return null;
                }
                DB::table('mail_outbox')->where('id', $outboxId)->update([
                    'status' => 'compensating',
                    'locked_at' => now(),
                    'lock_token' => $lockToken,
                    'last_error' => 'compensation_processing',
                    'updated_at' => now(),
                ]);

                return $candidate;
            }, 3);
        } catch (\Throwable $error) {
            Log::error('[mail] compensation claim failed', ['outbox_id' => $outboxId, 'exception' => $error::class]);

            return false;
        }
        if (! $row) {
            return true;
        }

        try {
            MailLifecycleCompensator::compensate(
                (string) $row->kind,
                is_string($row->resource_type) ? $row->resource_type : null,
                is_string($row->resource_id) ? $row->resource_id : null,
                is_string($row->resource_generation) ? $row->resource_generation : null,
            );
        } catch (\Throwable $error) {
            try {
                DB::table('mail_outbox')->where('id', $outboxId)
                    ->where('status', 'compensating')->where('lock_token', $lockToken)
                    ->update([
                        'status' => 'comp_pending',
                        'available_at' => now()->addMinute(),
                        'locked_at' => null,
                        'lock_token' => null,
                        'last_error' => 'compensation_unavailable',
                        'updated_at' => now(),
                    ]);
            } catch (\Throwable) {
                // A stale compensating claim is recovered by housekeeping.
            }
            OperationalMetrics::increment('mail.compensation_pending');
            Log::error('[mail] lifecycle compensation pending', [
                'outbox_id' => $outboxId,
                'kind' => (string) $row->kind,
                'exception' => $error::class,
            ]);

            return false;
        }

        try {
            $updated = DB::table('mail_outbox')->where('id', $outboxId)
                ->where('status', 'compensating')->where('lock_token', $lockToken)
                ->update([
                    'status' => 'compensated',
                    'encrypted_envelope' => '',
                    'locked_at' => null,
                    'lock_token' => null,
                    'last_error' => 'lifecycle_compensated',
                    'updated_at' => now(),
                ]);
        } catch (\Throwable $error) {
            // The lifecycle operation is idempotent. Keep/recover the durable
            // claim and repeat it until the terminal state can be recorded.
            Log::error('[mail] compensation completion write failed', [
                'outbox_id' => $outboxId,
                'exception' => $error::class,
            ]);

            return false;
        }
        if ($updated !== 1) {
            return false;
        }

        OperationalMetrics::increment('mail.compensated');
        try {
            Audit::write(null, 'mail.lifecycle_compensated', is_string($row->resource_type) ? $row->resource_type : 'mail', $row->resource_id, [
                'kind' => (string) $row->kind,
                'outbox_id' => $outboxId,
            ]);
        } catch (\Throwable) {
            // Audit is auxiliary after both lifecycle and outbox are durable.
        }

        return true;
    }
}
