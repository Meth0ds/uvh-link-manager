<?php

namespace App\Http\Controllers;

use App\Exceptions\LinkException;
use App\Support\IsoDate;
use App\Support\QrResources;
use App\Support\UvhRequest;
use App\Support\WorkspaceLimits;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class QrVariantController
{
    public function index(Request $request, int $linkId): JsonResponse
    {
        if (! DB::table('links')->where('workspace_id', UvhRequest::workspaceId($request))->where('id', $linkId)->exists()) {
            return response()->json(['error' => 'Enlace no encontrado.'], 404);
        }
        $rows = DB::table('qr_variants')->where('workspace_id', UvhRequest::workspaceId($request))->where('link_id', $linkId)->orderBy('id')->get();

        return response()->json(['variants' => $rows->map(QrResources::present(...))->all()]);
    }

    public function store(Request $request, int $linkId): JsonResponse
    {
        try {
            return response()->json(['variant' => QrResources::present(QrResources::create($request, 'qr_variants', $linkId))], 201);
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }
    }

    public function update(Request $request, int $linkId, int $id): JsonResponse
    {
        try {
            return response()->json(['variant' => QrResources::present(QrResources::update($request, 'qr_variants', $id, $linkId))]);
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }
    }

    public function comparison(Request $request, int $linkId): JsonResponse
    {
        if (DB::transactionLevel() === 0) {
            return DB::transaction(function () use ($request, $linkId): JsonResponse {
                // Read variant totals and overall visits from one snapshot:
                // concurrent analytics/retention must not shift attribution.
                DB::statement('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');

                return $this->comparison($request, $linkId);
            });
        }
        $workspaceId = UvhRequest::workspaceId($request);
        if (! DB::table('links')->where('workspace_id', $workspaceId)->where('id', $linkId)->exists()) {
            return response()->json(['error' => 'Enlace no encontrado.'], 404);
        }
        $from = $request->query('from', now('UTC')->subDays(29)->format('Y-m-d'));
        $to = $request->query('to', now('UTC')->format('Y-m-d'));
        if (! is_string($from) || ! is_string($to) || ! preg_match('/^\d{4}-\d{2}-\d{2}$/D', $from) || ! preg_match('/^\d{4}-\d{2}-\d{2}$/D', $to) || ! IsoDate::parse($from) || ! IsoDate::parse($to)) {
            return response()->json(['error' => 'Usa fechas válidas YYYY-MM-DD.'], 422);
        }
        $start = new \DateTimeImmutable($from, new \DateTimeZone('UTC'));
        $end = new \DateTimeImmutable($to, new \DateTimeZone('UTC'));
        if ($end < $start || $start->diff($end)->days >= WorkspaceLimits::ANALYTICS_RANGE_DAYS) {
            return response()->json(['error' => 'El periodo solicitado no está permitido.'], 422);
        }
        $variants = DB::table('qr_variants')->where('workspace_id', $workspaceId)->where('link_id', $linkId)->orderBy('id')->get();
        $counts = DB::table('qr_daily_counts')->whereIn('variant_id', $variants->pluck('id'))->whereBetween('day', [$from, $to])->get();
        $overall = DB::table('metric_rollups')->where('link_id', $linkId)->whereBetween('day', [$from, $to])->get(['day', 'clicks'])->keyBy('day');
        $attributed = (int) $counts->sum('visits');
        $totals = $counts->groupBy('variant_id')->map(fn ($rows): int => (int) $rows->sum('visits'));
        $series = [];
        for ($day = $start; $day <= $end; $day = $day->modify('+1 day')) {
            $date = $day->format('Y-m-d');
            $daily = $counts->where('day', $date);
            $visits = $overall->get($date);
            $series[] = ['day' => $date, 'hasData' => $visits !== null, 'visits' => $visits === null ? null : (int) $visits->clicks,
                'unattributed' => $visits === null ? null : max(0, (int) $visits->clicks - (int) $daily->sum('visits')),
                'variants' => $variants->map(fn ($variant): array => ['id' => (int) $variant->id, 'visits' => $visits === null ? null : (int) $daily->where('variant_id', $variant->id)->sum('visits')])->all()];
        }

        return response()->json(['from' => $from, 'to' => $to, 'timezone' => 'UTC', 'attributedVisits' => $attributed,
            'unattributedVisits' => max(0, (int) $overall->sum('clicks') - $attributed), 'series' => $series,
            'variants' => $variants->map(function ($variant) use ($totals, $attributed): array {
                $visits = $totals->get($variant->id, 0);

                return QrResources::present($variant) + ['visits' => $visits, 'attributedPercentage' => $attributed > 0 ? round($visits / $attributed * 100, 2) : null];
            })->all()])->header('Cache-Control', 'private, no-store');
    }
}
