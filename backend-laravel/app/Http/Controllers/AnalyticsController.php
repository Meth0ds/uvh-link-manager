<?php

namespace App\Http\Controllers;

use App\Support\AnalyticsOverview;
use App\Support\Csv;
use App\Support\IsoDate;
use App\Support\UvhRequest;
use App\Support\WorkspaceLimits;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class AnalyticsController
{
    private const PERIODS = ['24h', '7d', '30d', '90d', 'custom'];

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

        return response()->json($this->cachedOverview($workspaceId, $linkId, $range['start'], $range['end'], $range['rolling']));
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

        return response()->json($this->cachedOverview($workspaceId, $linkId, $range['start'], $range['end'], $range['rolling']));
    }

    /**
     * Exportación de analítica (F7) en CSV o JSON: sólo agregados.
     *
     * Los `visitor_hash` son seudónimos que rotan cada día y nunca abandonan
     * el motor de analítica: lo que sale por aquí son recuentos (clics y
     * visitantes del día), jamás los valores hash. Ni el JSON ni el CSV traen
     * columna alguna de identificador de visitante, y el CSV lleva cada celda
     * por el guardado anti-fórmulas de `Csv`.
     */
    public function export(Request $request): JsonResponse|Response
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $format = UvhRequest::queryString($request, 'format', 'csv');
        if (! in_array($format, ['csv', 'json'], true)) {
            return response()->json(['error' => 'format inválido (csv|json)'], 422);
        }
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

        $overview = $this->cachedOverview($workspaceId, $linkId, $range['start'], $range['end'], $range['rolling']);
        $filename = 'uvh-analytics-'.now()->format('Ymd').'.'.$format;

        if ($format === 'json') {
            return response((string) json_encode($overview, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), 200, [
                'Content-Type' => 'application/json; charset=UTF-8',
                'Content-Disposition' => 'attachment; filename="'.$filename.'"',
                'Cache-Control' => 'no-store',
            ]);
        }

        $lines = [Csv::line(['section', 'key', 'day', 'clicks', 'visitors'])];
        $lines[] = Csv::line(['totals', '', '', (string) $overview['totals']['clicks'], (string) $overview['totals']['visitors']]);
        foreach ($overview['series'] as $point) {
            $lines[] = Csv::line(['series', '', (string) $point['day'], (string) $point['clicks'], (string) $point['visitors']]);
        }
        foreach ($overview['topLinks'] as $link) {
            $lines[] = Csv::line(['top_links', (string) $link['alias'], '', (string) $link['clicks'], (string) $link['visitors']]);
        }
        foreach (['countries', 'devices', 'browsers', 'os', 'referrers', 'campaigns'] as $dimension) {
            foreach ($overview[$dimension] as $item) {
                $lines[] = Csv::line([$dimension, (string) $item['key'], '', (string) $item['value'], '']);
            }
        }

        return response(implode("\r\n", $lines)."\r\n", 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$filename.'"',
            'Cache-Control' => 'no-store',
        ]);
    }

    /**
     * @return array{ok: bool, error?: string, start?: string, end?: string, rolling?: bool}
     */
    private function parseRange(string $period, ?string $from, ?string $to): array
    {
        if (! in_array($period, self::PERIODS, true)) {
            return ['ok' => false, 'error' => 'period inválido (24h|7d|30d|90d|custom)'];
        }
        // `custom` is the date-picker range: its window comes entirely from the
        // two bounds, so both are mandatory instead of derived from a preset.
        if ($period === 'custom' && ($from === null || $to === null)) {
            return ['ok' => false, 'error' => 'custom requiere from y to'];
        }
        $parsedFrom = $from !== null ? IsoDate::parse($from) : null;
        if ($from !== null && $parsedFrom === null) {
            return ['ok' => false, 'error' => 'from debe ser una fecha ISO válida'];
        }
        $parsedTo = $to !== null ? IsoDate::parse($to) : null;
        if ($to !== null && $parsedTo === null) {
            return ['ok' => false, 'error' => 'to debe ser una fecha ISO válida'];
        }
        // A date-only `to` names a day, not its midnight: «hasta el 30» has to
        // include what happened during the 30th. Exact timestamps stay exact.
        if ($parsedTo !== null && preg_match('/^\d{4}-\d{2}-\d{2}$/D', (string) $to) === 1) {
            $parsedTo = $parsedTo->endOfDay();
        }

        $days = ['24h' => 1, '7d' => 7, '30d' => 30, '90d' => 90][$period] ?? 0;
        $end = $parsedTo ?? now();
        $start = $parsedFrom ?? $end->copy()->subDays($days);

        if ($start->gt($end)) {
            return ['ok' => false, 'error' => 'from debe ser anterior o igual a to'];
        }
        // Compare instants without dropping fractions or applying calendar-day
        // arithmetic across different offsets. Do not mutate either bound.
        $latestEnd = $start->copy()->utc()->addSeconds(self::MAX_RANGE_DAYS * 24 * 60 * 60);
        if ($end->gt($latestEnd)) {
            return ['ok' => false, 'error' => 'El rango solicitado supera el máximo de 180 días'];
        }

        return [
            'ok' => true,
            'start' => $start->format('Y-m-d\TH:i:s.uP'),
            'end' => $end->format('Y-m-d\TH:i:s.uP'),
            'rolling' => $from === null && $to === null,
        ];
    }

    /** @return array<string, mixed> */
    private function cachedOverview(int $workspaceId, ?int $linkId, string $start, string $end, bool $rolling): array
    {
        $ttl = max(0, min(60, (int) config('uvh.analytics.overview_cache_seconds', 30)));
        if ($ttl === 0) {
            return $this->buildOverview($workspaceId, $linkId, $start, $end);
        }
        // Rolling periods advance every request. A 30-second bucket makes their
        // cache reusable while bounding staleness. Any explicit bound remains
        // exact, even if it is close to now or overrides a preset period.
        $keyStart = $rolling ? intdiv(IsoDate::parse($start)->getTimestamp(), $ttl) : $start;
        $keyEnd = $rolling ? intdiv(IsoDate::parse($end)->getTimestamp(), $ttl) : $end;
        $key = 'uvh:analytics:overview:v3:'.hash('sha256', json_encode([$workspaceId, $linkId, $rolling, $keyStart, $keyEnd], JSON_THROW_ON_ERROR));
        try {
            $cached = Cache::get($key);
            if (is_array($cached)) {
                return $cached;
            }
        } catch (\Throwable) {
            // Cache is an optimization; authorization still ran before this method.
        }
        $overview = $this->buildOverview($workspaceId, $linkId, $start, $end);
        try {
            Cache::put($key, $overview, $ttl);
        } catch (\Throwable) {
            // Serve the coherent database snapshot if the cache is unavailable.
        }

        return $overview;
    }

    private function buildOverview(int $workspaceId, ?int $linkId, string $start, string $end): array
    {
        $overview = app(AnalyticsOverview::class)->overview($workspaceId, $linkId === null ? null : [$linkId], $start, $end);
        // Cache stores refuse PHP classes to prevent gadget-chain attacks.
        // Normalize at this cache boundary without changing the service's
        // collection contract for shared reports and other consumers.
        foreach (['series', 'topLinks'] as $section) {
            if ($overview[$section] instanceof Collection) {
                $overview[$section] = $overview[$section]->all();
            }
        }

        return $overview;
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
