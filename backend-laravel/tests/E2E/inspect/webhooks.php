<?php

declare(strict_types=1);

/**
 * Webhook deliveries and the retry schedule of an undelivered one.
 */

use Illuminate\Support\Facades\DB;

return [
    'webhook' => static fn (string $argument): array => DB::table('webhook_deliveries')->where('webhook_id', (int) $argument)->orderBy('id')->get()
        ->map(static fn ($row) => [
            'id' => (int) $row->id,
            'event' => (string) $row->event,
            'status' => (string) $row->status,
            'attempts' => (int) $row->attempts,
            'delivered_at' => $row->delivered_at !== null ? (string) $row->delivered_at : null,
            'next_attempt_at' => $row->next_attempt_at !== null ? (string) $row->next_attempt_at : null,
            'last_error' => $row->last_error !== null ? (string) $row->last_error : null,
        ])->all(),
    // webhook_deliveries is an append-only log with explicit timestamps and
    // no updated_at column; only the retry schedule may be advanced.

    'webhook-warp' => static fn (string $argument): array => ['warped' => DB::table('webhook_deliveries')->where('webhook_id', (int) $argument)
        ->where('status', 'pending')->update(['next_attempt_at' => now()])],
];
