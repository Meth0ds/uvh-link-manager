<?php

namespace App\Http\Controllers;

use App\Exceptions\LinkException;
use App\Support\AnalyticsReports;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class AnalyticsReportController
{
    public function index(Request $request): JsonResponse
    {
        try {
            AnalyticsReports::enabled();
            $rows = DB::table('analytics_reports')->where('workspace_id', UvhRequest::workspaceId($request))->orderByDesc('id')->paginate(20);

            return response()->json(['reports' => AnalyticsReports::presentMany($rows->getCollection(), UvhRequest::workspaceId($request)), 'page' => $rows->currentPage(), 'lastPage' => $rows->lastPage()]);
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }
    }

    public function show(Request $request, int $id): JsonResponse
    {
        try {
            AnalyticsReports::enabled();
            $row = DB::table('analytics_reports')->where('workspace_id', UvhRequest::workspaceId($request))->where('id', $id)->first();
            if (! $row) {
                throw new LinkException('Informe no encontrado.', 404);
            }

            return response()->json(['report' => AnalyticsReports::present($row)]);
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }
    }

    public function store(Request $request): JsonResponse
    {
        return $this->change($request, null, 'save', 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        return $this->change($request, $id, 'save');
    }

    public function revoke(Request $request, int $id): JsonResponse
    {
        return $this->change($request, $id, 'revoke');
    }

    public function rotate(Request $request, int $id): JsonResponse
    {
        return $this->change($request, $id, 'rotate');
    }

    private function change(Request $request, ?int $id, string $operation, int $status = 200): JsonResponse
    {
        try {
            return response()->json(AnalyticsReports::mutate($request, $id, $operation), $status);
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }
    }
}
