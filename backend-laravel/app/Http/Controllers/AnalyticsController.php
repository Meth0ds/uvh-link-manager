<?php

namespace App\Http\Controllers;

use App\Support\UvhRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AnalyticsController
{
    private const PERIODS = ['24h', '7d', '30d', '90d'];

    private const MAX_RANGE_DAYS = 180;

    public function overview(Request $request)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $linkId = $request->query('linkId') !== null ? (int) $request->query('linkId') : null;

        $range = $this->parseRange(
            (string) $request->query('period', '7d'),
            $request->query('from') !== null ? (string) $request->query('from') : null,
            $request->query('to') !== null ? (string) $request->query('to') : null,
        );
        if (! $range['ok']) {
            return response()->json(['error' => $range['error']], 422);
        }

        if ($linkId) {
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
        $linkId = $request->query('linkId') !== null ? (int) $request->query('linkId') : null;

        $range = $this->parseRange(
            (string) $request->query('period', '7d'),
            $request->query('from') !== null ? (string) $request->query('from') : null,
            $request->query('to') !== null ? (string) $request->query('to') : null,
        );
        if (! $range['ok']) {
            return response()->json(['error' => $range['error']], 422);
        }

        if ($linkId) {
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
        if ($from !== null && ! $this->isIsoDate($from)) {
            return ['ok' => false, 'error' => 'from debe ser una fecha ISO válida'];
        }
        if ($to !== null && ! $this->isIsoDate($to)) {
            return ['ok' => false, 'error' => 'to debe ser una fecha ISO válida'];
        }

        $days = ['24h' => 1, '7d' => 7, '30d' => 30, '90d' => 90][$period];
        $end = $to !== null ? \Illuminate\Support\Carbon::parse($to) : now();
        $start = $from !== null ? \Illuminate\Support\Carbon::parse($from) : $end->copy()->subDays($days);

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
        $startDay = substr($start, 0, 10);
        $endDay = substr($end, 0, 10);

        $rollupQuery = DB::table('metric_rollups')->whereBetween('day', [$startDay, $endDay]);
        if ($linkId !== null) {
            $rollupQuery->where('link_id', $linkId);
        } else {
            $rollupQuery->whereIn('link_id', fn ($q) => $q->select('id')->from('links')->where('workspace_id', $workspaceId));
        }
        $rollups = $rollupQuery->get();

        $totalClicks = (int) $rollups->sum('clicks');
        $totalVisitors = (int) $rollups->sum('visitors');

        $seriesQuery = DB::table('click_events')
            ->selectRaw("occurred_at::date AS day, COUNT(*) AS clicks, COUNT(DISTINCT visitor_hash) AS visitors")
            ->where('occurred_at', '>=', $start)
            ->where('occurred_at', '<=', $end);
        if ($linkId !== null) {
            $seriesQuery->where('link_id', $linkId);
        } else {
            $seriesQuery->whereIn('link_id', fn ($q) => $q->select('id')->from('links')->where('workspace_id', $workspaceId));
        }
        $series = $seriesQuery->groupBy('day')->orderBy('day')->get()->map(fn ($r) => [
            'day' => $r->day,
            'clicks' => (int) $r->clicks,
            'visitors' => (int) $r->visitors,
        ])->values();

        $topLinks = [];
        if ($linkId === null) {
            $topLinks = DB::table(DB::raw('('
                .'SELECT link_id, SUM(clicks)::int AS clicks, SUM(visitors)::int AS visitors '
                .'FROM metric_rollups WHERE day >= ? AND day <= ? GROUP BY link_id ORDER BY clicks DESC LIMIT 8'
                .') m'))
                ->join('links as l', 'l.id', '=', 'm.link_id')
                ->where('l.workspace_id', $workspaceId)
                ->addBinding($startDay, 'select')
                ->addBinding($endDay, 'select')
                ->get(['l.id', 'l.alias', 'l.destination', 'm.clicks', 'm.visitors'])
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
            'countries' => $this->top($this->mergeMaps($rollups->pluck('countries')->all())),
            'devices' => $this->top($this->mergeMaps($rollups->pluck('devices')->all())),
            'browsers' => $this->top($this->mergeMaps($rollups->pluck('browsers')->all())),
            'os' => $this->top($this->mergeMaps($rollups->pluck('os')->all())),
            'referrers' => $this->top($this->mergeMaps($rollups->pluck('referrers')->all())),
            'campaigns' => $this->top($this->mergeMaps($rollups->pluck('campaigns')->all())),
        ];
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

    private function isIsoDate(string $value): bool
    {
        try {
            \Illuminate\Support\Carbon::parse($value);

            return true;
        } catch (\Throwable) {
            return false;
        }
    }
}
