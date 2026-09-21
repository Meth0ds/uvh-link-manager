<?php

declare(strict_types=1);

/**
 * The mail outbox: what is queued, what was attempted, and the two schedules the
 * runbook lets a drill advance (the backoff and the staleness window).
 */

use App\Support\MailOutboxDispatcher;
use App\Support\UvhCrypto;
use Illuminate\Support\Facades\DB;

/** @return list<int> */
$outboxIdsFor = static function (string $email): array {
    $ids = [];
    $rows = DB::table('mail_outbox')->orderByDesc('id')->limit(200)->get(['id', 'encrypted_envelope']);
    foreach ($rows as $row) {
        try {
            $message = json_decode(UvhCrypto::decryptAtRest((string) $row->encrypted_envelope), true, 512, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            continue;
        }
        if (is_array($message) && strtolower((string) ($message['to'] ?? '')) === strtolower($email)) {
            $ids[] = (int) $row->id;
        }
    }

    return $ids;
};

$describe = static fn ($row): array => [
    'id' => (int) $row->id,
    'kind' => (string) $row->kind,
    'status' => (string) $row->status,
    'attempts' => (int) $row->attempts,
    'sent_at' => $row->sent_at !== null ? (string) $row->sent_at : null,
    'available_at' => $row->available_at !== null ? (string) $row->available_at : null,
    'last_error' => $row->last_error !== null ? (string) $row->last_error : null,
    'manual_retry_count' => (int) ($row->manual_retry_count ?? 0),
    // Length only: the envelope is never decrypted nor printed here.
    'envelope_bytes' => is_string($row->encrypted_envelope) ? strlen($row->encrypted_envelope) : 0,
];

/** Recipient lookup only works while the envelope still exists. */
$mailRows = static function (string $email) use ($outboxIdsFor, $describe): array {
    $ids = $outboxIdsFor($email);
    if ($ids === []) {
        return [];
    }

    return DB::table('mail_outbox')->whereIn('id', $ids)->orderBy('id')->get()
        ->map($describe)->all();
};

return [
    'mail' => static fn (string $argument): array => $mailRows($argument),
    // Once a message is sent the encrypted envelope is erased on purpose, so
    // the recipient is no longer queryable. Anything after delivery must be
    // addressed by kind or by the id captured while the row was still pending.

    'mail-kind' => static fn (string $argument): array => DB::table('mail_outbox')->where('kind', $argument)->orderBy('id')->get()
        ->map($describe)->all(),

    'mail-id' => static fn (string $argument): array => DB::table('mail_outbox')->where('id', (int) $argument)->get()->map($describe)->all(),

    'mail-warp' => static function (string $argument) use ($outboxIdsFor): array {
        $ids = $outboxIdsFor($argument);
        if ($ids === []) {
            return ['warped' => 0];
        }

        return ['warped' => DB::table('mail_outbox')->whereIn('id', $ids)->where('status', 'pending')
            ->update(['available_at' => now(), 'updated_at' => now()])];
    },
    // Advance the *recovery* schedule, not a product decision. Housekeeping
    // only re-publishes work whose publication or claim is older than its own
    // ten-minute window, so the window is what is moved here. Nothing about the
    // worker, the reconciler or the schedule itself changes.

    'mail-outbox-stale' => static function (string $argument) use ($outboxIdsFor): array {
        $ids = $outboxIdsFor($argument);
        if ($ids === []) {
            return ['aged' => 0];
        }
        $stale = now()->subMinutes(11);
        $aged = DB::table('mail_outbox')->whereIn('id', $ids)
            ->whereIn('status', ['queued', 'processing', 'compensating'])
            ->update(['queued_at' => $stale, 'updated_at' => $stale]);
        DB::table('mail_outbox')->whereIn('id', $ids)
            ->whereIn('status', ['processing', 'compensating'])
            ->update(['locked_at' => $stale]);

        return ['aged' => $aged];
    },
    // Delete what the broker is holding for the monitored queues, and nothing
    // else: the source-of-truth rows stay exactly as they were. This is the
    // "the broker lost its data" case, which is what a Redis restart without
    // persistence, a failover or an eviction would look like to the app.

    'outbox-publish' => static function (string $argument) use ($outboxIdsFor): array {
        $ids = $outboxIdsFor($argument);
        if ($ids === []) {
            return ['published' => 0];
        }
        DB::table('mail_outbox')->whereIn('id', $ids)->where('status', 'pending')
            ->update(['available_at' => now(), 'updated_at' => now()]);
        $published = 0;
        $pending = DB::table('mail_outbox')->whereIn('id', $ids)->where('status', 'pending')
            ->orderBy('id')->pluck('id');
        foreach ($pending as $id) {
            MailOutboxDispatcher::enqueue((int) $id);
            $published++;
        }

        return ['published' => $published];
    },
    // Retention age for the terminal rows the purge stage is allowed to delete.

    'outbox-age' => static function (string $argument): array {
        [$id, $days] = array_pad(preg_split('/\s+/', trim($argument)) ?: [], 2, '');
        $aged = max(1, min(3650, (int) $days));

        return ['aged' => DB::table('mail_outbox')->where('id', (int) $id)
            ->update(['updated_at' => now()->subDays($aged)])];
    },
];
