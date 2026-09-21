<?php

declare(strict_types=1);

/**
 * The rollup pool: what a link counted, the row-level contention the server
 * sees, and the levers the capacity passes use to place a backlog.
 */

use App\Jobs\RecordClickAnalyticsJob;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

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

return [
    'analytics' => static function (string $argument): array {
        $linkId = (int) $argument;

        return [
            'click_count' => (int) DB::table('links')->where('id', $linkId)->value('click_count'),
            'click_events' => (int) DB::table('click_events')->where('link_id', $linkId)->count(),
            'rollup_clicks' => (int) DB::table('metric_rollups')->where('link_id', $linkId)->sum('clicks'),
        ];
    },
    // Row-level contention, as the server sees it. A driver that cannot be
    // asked reports -1 instead of a healthy-looking zero, so the harness can
    // never read "no lock waits" out of a database it never queried.

    'lock-wait' => static function (string $argument) use ($lockWaitSql): array {
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
    },
    // Cumulative counters: the drill subtracts two snapshots, so a single
    // reading is never presented as a rate.

    'rollup-stats' => static function (string $argument) use ($rollupStatsSql): array {
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
    },
    // Storage parameters for the fillfactor hypothesis. This only makes sense on
    // the ephemeral stack: it rewrites one table and does not touch the schema
    // the migrations define, so it is measurement setup, not a product change.
    // `VACUUM FULL` is what makes the setting apply to pages that already exist.

    'rollup-fillfactor' => static function (string $argument): array {
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
    },
    // Enqueue analytics jobs directly, so a backlog can be placed on a chosen
    // rollup row without depending on how fast the public redirect path admits
    // clicks. The payload is exactly what `RedirectController` queues, with a
    // bounded visitor set so the click does not become a new visitor every
    // time; only the bounded dimensions in it are varied.
    //
    // Usage: `rollup-flood "<count> <linkId>[,<linkId>...]"`

    'rollup-flood' => static function (string $argument): array {
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
    },
    // The same view for a set of links in one boot. The contention drill polls
    // this while a pass drains, and one child process per link per poll would
    // be measuring the harness instead of the pool.

    'analytics-batch' => static function (string $argument): array {
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
    },
];
