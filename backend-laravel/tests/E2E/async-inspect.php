<?php

declare(strict_types=1);

/**
 * State reader for the async E2E driver.
 *
 * The browser suite asserts what a user sees. This harness has to assert what
 * a worker eventually wrote, so it needs a narrow, read-mostly window into the
 * durable tables. Every subcommand prints one JSON document on stdout.
 *
 * `*-warp` subcommands advance a *retry schedule* to now. They do not change
 * any product decision: the worker, the backoff policy and the scheduler tick
 * are untouched. Waiting 60 real seconds for a first retry would otherwise
 * make the suite unusable, and the repository already establishes this
 * pattern (age-mfa-session.php, age-trash-links.php).
 */

use App\Support\QueueBacklog;
use App\Support\UvhCrypto;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Queue\RedisQueue;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Redis;

require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$database = (string) config('database.connections.'.config('database.default').'.database');
if (! app()->environment('testing') || ! str_ends_with($database, '_test')) {
    fwrite(STDERR, "Refusing to inspect state outside APP_ENV=testing and a _test database.\n");
    exit(64);
}

$command = (string) ($argv[1] ?? '');
$argument = (string) ($argv[2] ?? '');

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

$output = match ($command) {
    'mail' => $mailRows($argument),
    // Once a message is sent the encrypted envelope is erased on purpose, so
    // the recipient is no longer queryable. Anything after delivery must be
    // addressed by kind or by the id captured while the row was still pending.
    'mail-kind' => DB::table('mail_outbox')->where('kind', $argument)->orderBy('id')->get()
        ->map($describe)->all(),
    'mail-id' => DB::table('mail_outbox')->where('id', (int) $argument)->get()->map($describe)->all(),
    'mail-warp' => (function () use ($argument, $outboxIdsFor): array {
        $ids = $outboxIdsFor($argument);
        if ($ids === []) {
            return ['warped' => 0];
        }

        return ['warped' => DB::table('mail_outbox')->whereIn('id', $ids)->where('status', 'pending')
            ->update(['available_at' => now(), 'updated_at' => now()])];
    })(),
    // Advance the *recovery* schedule, not a product decision. Housekeeping
    // only re-publishes work whose publication or claim is older than its own
    // ten-minute window, so the window is what is moved here. Nothing about the
    // worker, the reconciler or the schedule itself changes.
    'mail-outbox-stale' => (function () use ($argument, $outboxIdsFor): array {
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
    })(),
    // Delete what the broker is holding for the monitored queues, and nothing
    // else: the source-of-truth rows stay exactly as they were. This is the
    // "the broker lost its data" case, which is what a Redis restart without
    // persistence, a failover or an eviction would look like to the app.
    'broker-flush' => (function (): array {
        $connection = Queue::connection();
        if (! $connection instanceof RedisQueue) {
            return ['flushed' => 0, 'driver' => 'not-redis'];
        }
        $client = Redis::connection((string) config('queue.connections.'.(string) config('queue.default').'.connection', 'default'));
        $keys = [];
        foreach (array_values(QueueBacklog::pools()) as $queue) {
            $key = $connection->getQueue($queue);
            $keys = [...$keys, $key, $key.':delayed', $key.':reserved'];
        }

        return ['flushed' => (int) $client->del($keys), 'driver' => 'redis'];
    })(),
    'webhook' => DB::table('webhook_deliveries')->where('webhook_id', (int) $argument)->orderBy('id')->get()
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
    'webhook-warp' => ['warped' => DB::table('webhook_deliveries')->where('webhook_id', (int) $argument)
        ->where('status', 'pending')->update(['next_attempt_at' => now()])],
    'analytics' => (function () use ($argument): array {
        $linkId = (int) $argument;

        return [
            'click_count' => (int) DB::table('links')->where('id', $linkId)->value('click_count'),
            'click_events' => (int) DB::table('click_events')->where('link_id', $linkId)->count(),
            'rollup_clicks' => (int) DB::table('metric_rollups')->where('link_id', $linkId)->sum('clicks'),
        ];
    })(),
    'export' => (function () use ($argument): array {
        $row = DB::table('data_export_requests')->where('id', (int) $argument)->first();

        return $row === null ? [] : [
            'id' => (int) $row->id,
            'status' => (string) $row->status,
            'artifact' => $row->artifact_path !== null ? basename((string) $row->artifact_path) : null,
            'ready_at' => $row->ready_at !== null ? (string) $row->ready_at : null,
            'downloaded_at' => $row->downloaded_at !== null ? (string) $row->downloaded_at : null,
        ];
    })(),
    'export-latest' => (function (): array {
        $row = DB::table('data_export_requests')->orderByDesc('id')->first();

        return $row === null ? [] : [
            'id' => (int) $row->id,
            'status' => (string) $row->status,
            'artifact' => $row->artifact_path !== null ? basename((string) $row->artifact_path) : null,
            'ready_at' => $row->ready_at !== null ? (string) $row->ready_at : null,
            'downloaded_at' => $row->downloaded_at !== null ? (string) $row->downloaded_at : null,
            // Only a prefix: enough to diagnose a bearer mismatch without
            // ever printing a usable or reversible token material.
            'confirmation_hash' => is_string($row->confirmation_token_hash) ? substr($row->confirmation_token_hash, 0, 12) : null,
            'download_hash' => is_string($row->download_token_hash) ? substr($row->download_token_hash, 0, 12) : null,
        ];
    })(),
    'domain' => (function () use ($argument): array {
        $row = DB::table('custom_domains')->where('id', (int) $argument)->first();

        return $row === null ? [] : [
            'id' => (int) $row->id,
            'state' => (string) $row->state,
            'dns_error' => $row->dns_error !== null ? (string) $row->dns_error : null,
            'verified_at' => $row->verified_at !== null ? (string) $row->verified_at : null,
            'ownership_verified_at' => $row->ownership_verified_at !== null ? (string) $row->ownership_verified_at : null,
            'routing_verified_at' => $row->routing_verified_at !== null ? (string) $row->routing_verified_at : null,
        ];
    })(),
    // Depth comes from the configured broker. The database driver answers
    // from the `jobs` table and Redis from its own structures, so this read
    // keeps working after the broker moves. -1 marks an unreadable sample, so
    // the driver's "no job left in the queue" assertion cannot pass on a
    // broker the harness was unable to ask.
    'queue' => array_map(
        static fn (string $queue): array => [
            'queue' => $queue,
            'pending' => QueueBacklog::pending($queue) ?? -1,
        ],
        array_values(QueueBacklog::pools()),
    ),
    default => ['error' => 'unknown subcommand'],
};

if (isset($output['error'])) {
    fwrite(STDERR, $output['error']."\n");
    exit(64);
}

fwrite(STDOUT, json_encode($output, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n");
