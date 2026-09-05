<?php

namespace App\Support;

use App\Jobs\DeliverMailOutboxJob;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/** Publishes a durable outbox row without exposing its encrypted payload. */
final class MailOutboxDispatcher
{
    public static function enqueue(int $outboxId): bool
    {
        try {
            $claimed = DB::transaction(function () use ($outboxId): bool {
                $row = DB::table('mail_outbox')
                    ->where('id', $outboxId)
                    ->where('status', 'pending')
                    ->where('available_at', '<=', now())
                    ->lockForUpdate()
                    ->first();
                if (! $row) {
                    return false;
                }
                DB::table('mail_outbox')->where('id', $outboxId)->update([
                    'status' => 'queued',
                    'queued_at' => now(),
                    'updated_at' => now(),
                ]);
                return true;
            });
        } catch (\Throwable $error) {
            Log::error('[mail] outbox claim failed', ['outbox_id' => $outboxId, 'exception' => $error::class]);
            return false;
        }

        if (! $claimed) {
            return true;
        }

        try {
            DeliverMailOutboxJob::dispatch($outboxId);
            return true;
        } catch (\Throwable $error) {
            try {
                DB::table('mail_outbox')->where('id', $outboxId)->where('status', 'queued')->update([
                    'status' => 'pending',
                    'queued_at' => null,
                    'available_at' => now(),
                    'last_error' => 'queue_unavailable',
                    'updated_at' => now(),
                ]);
            } catch (\Throwable) {
                // A stale queued row is reclaimed by housekeeping.
            }
            Log::error('[mail] outbox queue dispatch failed', ['outbox_id' => $outboxId, 'exception' => $error::class]);
            return false;
        }
    }
}
