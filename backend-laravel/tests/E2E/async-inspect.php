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

use App\Jobs\RecordClickAnalyticsJob;
use App\Support\QueueBacklog;
use App\Support\UvhCrypto;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Queue\RedisQueue;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;

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

/**
 * Waiters on row locks, read from the server rather than inferred from wall
 * clock time. `on_metric_rollups` is an approximation: a backend waiting on a
 * transaction id does not name the table it wants, so the waiting statement
 * text is the only available hint, and it is reported as a hint.
 */
$lockWaitSql = <<<'SQL'
    SELECT
        count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS blocked,
        COALESCE(
            max(extract(epoch FROM (now() - state_change))) FILTER (WHERE wait_event_type = 'Lock'),
            0
        )::float8 AS max_wait_seconds,
        count(*) FILTER (WHERE wait_event_type = 'Lock' AND query ILIKE '%metric_rollups%')::int AS on_metric_rollups
    FROM pg_stat_activity
    WHERE backend_type = 'client backend'
    SQL;

/** Write counters for the tables the click path touches. */
$rollupStatsSql = <<<'SQL'
    SELECT c.relname,
           COALESCE(s.n_tup_ins, 0)::int AS inserts,
           COALESCE(s.n_tup_upd, 0)::int AS updates,
           COALESCE(s.n_tup_hot_upd, 0)::int AS hot_updates,
           COALESCE(s.n_dead_tup, 0)::int AS dead_tuples,
           COALESCE(s.n_live_tup, 0)::int AS live_tuples,
           COALESCE(array_to_string(c.reloptions, ','), '') AS options
    FROM pg_class c
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE c.relname IN ('metric_rollups', 'metric_unique_visitors', 'click_events')
    ORDER BY c.relname
    SQL;

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
    // Row-level contention, as the server sees it. A driver that cannot be
    // asked reports -1 instead of a healthy-looking zero, so the harness can
    // never read "no lock waits" out of a database it never queried.
    'lock-wait' => (function () use ($lockWaitSql): array {
        if (DB::getDriverName() !== 'pgsql') {
            return ['driver' => DB::getDriverName(), 'blocked' => -1, 'max_wait_seconds' => -1, 'on_metric_rollups' => -1];
        }

        $row = DB::selectOne($lockWaitSql);

        return [
            'driver' => 'pgsql',
            'blocked' => (int) ($row->blocked ?? 0),
            'max_wait_seconds' => round((float) ($row->max_wait_seconds ?? 0), 3),
            'on_metric_rollups' => (int) ($row->on_metric_rollups ?? 0),
        ];
    })(),
    // Cumulative counters: the drill subtracts two snapshots, so a single
    // reading is never presented as a rate.
    'rollup-stats' => (function () use ($rollupStatsSql): array {
        if (DB::getDriverName() !== 'pgsql') {
            return ['driver' => DB::getDriverName()];
        }

        $out = ['driver' => 'pgsql'];
        foreach (DB::select($rollupStatsSql) as $row) {
            $out[(string) $row->relname] = [
                'inserts' => (int) $row->inserts,
                'updates' => (int) $row->updates,
                'hot_updates' => (int) $row->hot_updates,
                'dead_tuples' => (int) $row->dead_tuples,
                'live_tuples' => (int) $row->live_tuples,
                'options' => (string) $row->options,
            ];
        }

        return $out;
    })(),
    // Storage parameters for the fillfactor hypothesis. This only makes sense on
    // the ephemeral stack: it rewrites one table and does not touch the schema
    // the migrations define, so it is measurement setup, not a product change.
    // `VACUUM FULL` is what makes the setting apply to pages that already exist.
    'rollup-fillfactor' => (function () use ($argument): array {
        if (DB::getDriverName() !== 'pgsql') {
            return ['driver' => DB::getDriverName(), 'fillfactor' => -1];
        }

        $fillfactor = (int) $argument;
        if ($fillfactor < 10 || $fillfactor > 100) {
            return ['error' => 'fillfactor must be between 10 and 100'];
        }

        DB::statement("ALTER TABLE metric_rollups SET (fillfactor = {$fillfactor})");
        DB::statement('VACUUM FULL metric_rollups');

        return ['fillfactor' => $fillfactor];
    })(),
    // Enqueue analytics jobs directly, so a backlog can be placed on a chosen
    // rollup row without depending on how fast the public redirect path admits
    // clicks. The payload is exactly what `RedirectController` queues, with a
    // bounded visitor set so the click does not become a new visitor every
    // time; only the bounded dimensions in it are varied.
    //
    // Usage: `rollup-flood "<count> <linkId>[,<linkId>...]"`
    'rollup-flood' => (function () use ($argument): array {
        [$rawCount, $rawIds] = array_pad(preg_split('/\s+/', trim($argument), 2) ?: [], 2, '');
        $total = (int) $rawCount;
        $ids = array_values(array_filter(
            array_map(static fn (string $id): int => (int) trim($id), explode(',', $rawIds)),
            static fn (int $id): bool => $id > 0,
        ));
        if ($total < 1 || $total > 20_000 || $ids === []) {
            return ['dispatched' => 0, 'per_link' => [], 'error' => 'expected "<count 1..20000> <linkId>[,<linkId>...]"'];
        }

        $countries = ['ES', 'US', 'MX', 'DE', 'FR', 'GB', 'BR', 'AR'];
        $browsers = ['chrome', 'safari', 'firefox'];
        $systems = ['windows', 'android', 'ios', 'macos'];
        $visitors = array_map(static fn (int $index): string => hash('sha256', 'uvh-async-drill-visitor-'.$index), range(0, 7));
        $occurredAt = now()->utc()->toIso8601String();
        $perLink = [];
        for ($index = 0; $index < $total; $index++) {
            $linkId = $ids[$index % count($ids)];
            $perLink[(string) $linkId] = ($perLink[(string) $linkId] ?? 0) + 1;
            RecordClickAnalyticsJob::dispatch(
                (string) Str::uuid(),
                $linkId,
                $occurredAt,
                [
                    'country' => $countries[$index % count($countries)],
                    'device' => $index % 3 === 0 ? 'desktop' : 'mobile',
                    'browser' => $browsers[$index % count($browsers)],
                    'os' => $systems[$index % count($systems)],
                    'referrer_domain' => $index % 5 === 0 ? 'example.org' : null,
                    'campaign' => $index % 7 === 0 ? 'drill' : null,
                    'visitor_hash' => $visitors[$index % count($visitors)],
                ],
            );
        }

        return ['dispatched' => $total, 'per_link' => $perLink, 'visitors' => count($visitors)];
    })(),
    // The same view for a set of links in one boot. The contention drill polls
    // this while a pass drains, and one child process per link per poll would
    // be measuring the harness instead of the pool.
    'analytics-batch' => (function () use ($argument): array {
        $ids = array_values(array_filter(
            array_map(static fn (string $id): int => (int) $id, explode(',', $argument)),
            static fn (int $id): bool => $id > 0,
        ));
        if ($ids === []) {
            return [];
        }

        $events = DB::table('click_events')->whereIn('link_id', $ids)
            ->selectRaw('link_id, count(*) AS total')->groupBy('link_id')->pluck('total', 'link_id');
        $rollups = DB::table('metric_rollups')->whereIn('link_id', $ids)
            ->selectRaw('link_id, sum(clicks) AS total')->groupBy('link_id')->pluck('total', 'link_id');
        $counters = DB::table('links')->whereIn('id', $ids)->pluck('click_count', 'id');

        $out = [];
        foreach ($ids as $id) {
            $out[(string) $id] = [
                'click_count' => (int) ($counters[$id] ?? 0),
                'click_events' => (int) ($events[$id] ?? 0),
                'rollup_clicks' => (int) ($rollups[$id] ?? 0),
            ];
        }

        return $out;
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
