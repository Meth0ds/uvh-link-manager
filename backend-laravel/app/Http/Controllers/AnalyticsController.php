<?php

namespace App\Http\Controllers;

use App\Support\IsoDate;
use App\Support\UvhRequest;
use App\Support\WorkspaceLimits;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AnalyticsController
{
    private const PERIODS = ['24h', '7d', '30d', '90d'];

    private const MAX_RANGE_DAYS = WorkspaceLimits::ANALYTICS_RANGE_DAYS;

    public function overview(Request $request)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $linkIdResult = $this->parseLinkId($request->query('linkId'));
        if (! $linkIdResult['ok']) {
            return response()->json(['error' => 'linkId debe ser un entero positivo'], 422);
        }
        $linkId = $linkIdResult['value'];

        $range = $this->parseRange(
            UvhRequest::queryString($request, 'period', '7d'),
            $request->query('from') !== null ? UvhRequest::queryString($request, 'from') : null,
            $request->query('to') !== null ? UvhRequest::queryString($request, 'to') : null,
        );
        if (! $range['ok']) {
            return response()->json(['error' => $range['error']], 422);
        }

        if ($linkId !== null) {
            $exists = DB::table('links')->where('id', $linkId)->where('workspace_id', $workspaceId)->exists();
            if (! $exists) {
                return response()->json(['error' => 'Enlace no encontrado'], 404);
            }
        }

        return response()->json($this->buildOverview($workspaceId, $linkId, $range['start'], $range['end']));
    }

    public function publicOverview(Request $request)
    {
        $apiToken = UvhRequest::apiToken($request);
        $workspaceId = $apiToken['workspace_id'];
        $linkIdResult = $this->parseLinkId($request->query('linkId'));
        if (! $linkIdResult['ok']) {
            return response()->json(['error' => 'linkId debe ser un entero positivo'], 422);
        }
        $linkId = $linkIdResult['value'];

        $range = $this->parseRange(
            UvhRequest::queryString($request, 'period', '7d'),
            $request->query('from') !== null ? UvhRequest::queryString($request, 'from') : null,
            $request->query('to') !== null ? UvhRequest::queryString($request, 'to') : null,
        );
        if (! $range['ok']) {
            return response()->json(['error' => $range['error']], 422);
        }

        if ($linkId !== null) {
            $exists = DB::table('links')->where('id', $linkId)->where('workspace_id', $workspaceId)->exists();
            if (! $exists) {
                return response()->json(['error' => 'Enlace no encontrado'], 404);
            }
        }

        return response()->json($this->buildOverview($workspaceId, $linkId, $range['start'], $range['end']));
    }

    /**
     * @return array{ok: bool, error?: string, start?: string, end?: string}
     */
    private function parseRange(string $period, ?string $from, ?string $to): array
    {
        if (! in_array($period, self::PERIODS, true)) {
            return ['ok' => false, 'error' => 'period inválido (24h|7d|30d|90d)'];
        }
        $parsedFrom = $from !== null ? IsoDate::parse($from) : null;
        if ($from !== null && $parsedFrom === null) {
            return ['ok' => false, 'error' => 'from debe ser una fecha ISO válida'];
        }
        $parsedTo = $to !== null ? IsoDate::parse($to) : null;
        if ($to !== null && $parsedTo === null) {
            return ['ok' => false, 'error' => 'to debe ser una fecha ISO válida'];
        }

        $days = ['24h' => 1, '7d' => 7, '30d' => 30, '90d' => 90][$period];
        $end = $parsedTo ?? now();
        $start = $parsedFrom ?? $end->copy()->subDays($days);

        if ($start->gt($end)) {
            return ['ok' => false, 'error' => 'from debe ser anterior o igual a to'];
        }
        if ($end->diffInDays($start) > self::MAX_RANGE_DAYS) {
            return ['ok' => false, 'error' => 'El rango solicitado supera el máximo de 180 días'];
        }

        return ['ok' => true, 'start' => $start->toIso8601String(), 'end' => $end->toIso8601String()];
    }

    private function buildOverview(int $workspaceId, ?int $linkId, string $start, string $end): array
    {
        // Event rows are the source of truth for arbitrary time ranges. Daily
        // rollups remain a bounded acceleration structure for retention/jobs,
        // but summing daily visitors would double-count the same person across
        // days and can include hours outside a 24-hour range.
        $events = DB::table('click_events as e')
            ->join('links as l', 'l.id', '=', 'e.link_id')
            ->where('l.workspace_id', $workspaceId)
            ->where('e.occurred_at', '>=', $start)
            ->where('e.occurred_at', '<=', $end);
        if ($linkId !== null) {
            $events->where('e.link_id', $linkId);
        }
        $totalClicks = (int) (clone $events)->count();
        $totalVisitors = (int) (clone $events)->whereNotNull('e.visitor_hash')->distinct()->count('e.visitor_hash');

        $seriesQuery = (clone $events)
            ->selectRaw('e.occurred_at::date AS day, COUNT(*) AS clicks, COUNT(DISTINCT e.visitor_hash) AS visitors')
            ->groupBy('day')->orderBy('day');
        $series = $seriesQuery->get()->map(fn ($r) => [
            'day' => $r->day,
            'clicks' => (int) $r->clicks,
            'visitors' => (int) $r->visitors,
        ])->values();

        $topLinks = [];
        if ($linkId === null) {
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

        return [
            'totals' => ['clicks' => $totalClicks, 'visitors' => $totalVisitors],
            'series' => $series,
            'topLinks' => $topLinks,
            'countries' => $this->dimension($events, 'country'),
            'devices' => $this->dimension($events, 'device'),
            'browsers' => $this->dimension($events, 'browser'),
            'os' => $this->dimension($events, 'os'),
            'referrers' => $this->dimension($events, 'referrer_domain'),
            'campaigns' => $this->dimension($events, 'campaign'),
        ];
    }

    private function dimension($events, string $column): array
    {
        $allowed = ['country', 'device', 'browser', 'os', 'referrer_domain', 'campaign'];
        if (! in_array($column, $allowed, true)) {
            return [];
        }

        return (clone $events)
            ->whereNotNull('e.'.$column)
            ->where('e.'.$column, '!=', '')
            ->selectRaw('e.'.$column.' AS key, COUNT(*)::int AS value')
            ->groupBy('e.'.$column)
            ->orderByDesc('value')
            ->limit(8)
            ->get()
            ->map(fn ($row) => ['key' => $row->key, 'value' => (int) $row->value])
            ->values()
            ->all();
    }

    private function mergeMaps(array $list): array
    {
        $out = [];
        foreach ($list as $raw) {
            if ($raw === null || $raw === '') {
                continue;
            }
            $map = is_array($raw) ? $raw : json_decode((string) $raw, true);
            if (! is_array($map)) {
                continue;
            }
            foreach ($map as $k => $v) {
                $out[$k] = ($out[$k] ?? 0) + (int) $v;
            }
        }

        return $out;
    }

    private function top(array $map, int $n = 8): array
    {
        arsort($map);
        $out = [];
        $i = 0;
        foreach ($map as $key => $value) {
            if ($i++ >= $n) {
                break;
            }
            $out[] = ['key' => $key, 'value' => (int) $value];
        }

        return $out;
    }

    /** @return array{ok: bool, value: ?int} */
    private function parseLinkId(mixed $value): array
    {
        if ($value === null) {
            return ['ok' => true, 'value' => null];
        }
        if (is_int($value)) {
            return ['ok' => $value > 0, 'value' => $value > 0 ? $value : null];
        }
        if (! is_string($value) || ! preg_match('/^[1-9][0-9]{0,18}$/D', $value)) {
            return ['ok' => false, 'value' => null];
        }
        $validated = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return $validated === false
            ? ['ok' => false, 'value' => null]
            : ['ok' => true, 'value' => $validated];
    }
}
