<?php

namespace App\Support;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/** Shared bounded analytics query; public callers use an explicit projection. */
final class AnalyticsOverview
{
    /** @param list<int>|null $linkIds
     * @return array<string, mixed>
     */
    public function overview(int $workspaceId, ?array $linkIds, string $start, string $end, bool $public = false): array
    {
        if (DB::transactionLevel() === 0) {
            return DB::transaction(function () use ($workspaceId, $linkIds, $start, $end, $public): array {
                DB::statement('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');

                return $this->overview($workspaceId, $linkIds, $start, $end, $public);
            });
        }
        // Event rows are the source of truth for arbitrary time ranges. Daily
        // rollups remain a bounded acceleration structure for retention/jobs,
        // but summing daily visitors would double-count the same person across
        // days and can include hours outside a 24-hour range.
        $events = DB::table('click_events as e')
            ->join('links as l', 'l.id', '=', 'e.link_id')
            ->where('l.workspace_id', $workspaceId)
            ->where('e.occurred_at', '>=', $start)
            ->where('e.occurred_at', '<=', $end);
        if ($public) {
            $events->where('e.occurred_at', '>=', now()->utc()->subDays(WorkspaceLimits::analyticsRetentionDays())->format('Y-m-d\TH:i:s.uP'));
        }
        if ($linkIds !== null) {
            $events->whereIn('e.link_id', $linkIds);
        }
        // COUNT(DISTINCT) ignores NULL hashes without excluding anonymous clicks
        // from the click total. Both totals share one scan of the same snapshot.
        $totals = (clone $events)
            ->selectRaw($public ? 'count(*) AS clicks, 0 AS visitors' : 'count(*) AS clicks, count(DISTINCT e.visitor_hash) AS visitors')
            ->firstOrFail();
        $totalClicks = (int) $totals->clicks;
        $totalVisitors = (int) $totals->visitors;

        $seriesQuery = (clone $events)
            // Group in UTC explicitly so database-session timezone cannot move
            // an event to a different calendar bucket than the API returns.
            ->selectRaw("timezone('UTC', e.occurred_at)::date AS day, COUNT(*) AS clicks, ".($public ? '0 AS visitors' : 'COUNT(DISTINCT e.visitor_hash) AS visitors'))
            ->groupBy('day')->orderBy('day');
        $observedSeries = $seriesQuery->get()->mapWithKeys(fn ($r) => [(string) $r->day => [
            'day' => $r->day,
            'clicks' => (int) $r->clicks,
            'visitors' => (int) $r->visitors,
        ]]);

        // Missing rows mean a complete day with zero events, not unavailable
        // data. Materialize the bounded UTC calendar so spacing is temporal.
        $series = collect();
        $cursor = IsoDate::parse($start)?->utc()->startOfDay();
        $lastDay = IsoDate::parse($end)?->utc()->startOfDay();
        while ($cursor !== null && $lastDay !== null && $cursor->lte($lastDay)) {
            $day = $cursor->toDateString();
            $series->push($observedSeries->get($day, ['day' => $day, 'clicks' => 0, 'visitors' => 0]));
            $cursor->addDay();
        }

        $topLinks = [];
        if ($linkIds === null && ! $public) {
            $topLinks = (clone $events)
                ->selectRaw('l.id, l.alias, l.destination, COUNT(*)::int AS clicks, COUNT(DISTINCT e.visitor_hash)::int AS visitors')
                ->groupBy('l.id', 'l.alias', 'l.destination')
                ->orderByDesc('clicks')
                ->limit(8)
                ->get()
                ->map(fn ($r) => [
                    'id' => $r->id,
                    'alias' => $r->alias,
                    'destination' => $r->destination,
                    'clicks' => (int) $r->clicks,
                    'visitors' => (int) $r->visitors,
                ])
                ->values();
        }

        $countries = $this->dimension($events, 'country');
        $devices = $this->dimension($events, 'device');
        $browsers = $public ? ['items' => [], 'total' => 0] : $this->dimension($events, 'browser');
        $operatingSystems = $public ? ['items' => [], 'total' => 0] : $this->dimension($events, 'os');
        $referrers = $public ? ['items' => [], 'total' => 0] : $this->dimension($events, 'referrer_domain');
        $campaigns = $public ? ['items' => [], 'total' => 0] : $this->dimension($events, 'campaign');

        return [
            'totals' => ['clicks' => $totalClicks, 'visitors' => $totalVisitors],
            // Visitor hashes intentionally rotate daily. Declare the privacy
            // metric instead of suggesting cross-day person identification.
            'visitorMetric' => 'daily_pseudonyms',
            'series' => $series,
            'topLinks' => $topLinks,
            'countries' => $countries['items'],
            'devices' => $devices['items'],
            'browsers' => $browsers['items'],
            'os' => $operatingSystems['items'],
            'referrers' => $referrers['items'],
            'campaigns' => $campaigns['items'],
            'dimensionTotals' => [
                'countries' => $countries['total'],
                'devices' => $devices['total'],
                'browsers' => $browsers['total'],
                'os' => $operatingSystems['total'],
                'referrers' => $referrers['total'],
                'campaigns' => $campaigns['total'],
            ],
        ];
    }

    /** @return array{items: array<int, array{key: string, value: int}>, total: int} */
    private function dimension(Builder $events, string $column): array
    {
        $allowed = ['country', 'device', 'browser', 'os', 'referrer_domain', 'campaign'];
        if (! in_array($column, $allowed, true)) {
            return ['items' => [], 'total' => 0];
        }

        $rows = (clone $events)
            ->whereNotNull('e.'.$column)
            ->where('e.'.$column, '!=', '')
            // The window counts grouped categories before LIMIT, keeping the
            // compact top-eight payload while exposing an honest total.
            ->selectRaw('e.'.$column.' AS key, COUNT(*)::int AS value, COUNT(*) OVER()::int AS category_total')
            ->groupBy('e.'.$column)
            ->orderByDesc('value')
            ->limit(8)
            ->get();

        return [
            'items' => $rows
                ->map(fn ($row) => ['key' => $row->key, 'value' => (int) $row->value])
                ->values()
                ->all(),
            'total' => $rows->isEmpty() ? 0 : (int) $rows->first()->category_total,
        ];
    }
}
