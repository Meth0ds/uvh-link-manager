<?php

namespace App\Http\Controllers;

use App\Exceptions\LinkException;
use App\Support\QrResources;
use App\Support\UvhRequest;
use App\Support\WorkspaceMutation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class QrDesignController
{
    public function index(Request $request): JsonResponse
    {
        $rows = DB::table('qr_designs')->where('workspace_id', UvhRequest::workspaceId($request))->orderBy('name')->orderBy('id')->get();

        return response()->json(['designs' => $rows->map(QrResources::present(...))->all()]);
    }

    public function store(Request $request): JsonResponse
    {
        try {
            return response()->json(['design' => QrResources::present(QrResources::create($request, 'qr_designs'))], 201);
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }
    }

    public function update(Request $request, int $id): JsonResponse
    {
        try {
            return response()->json(['design' => QrResources::present(QrResources::update($request, 'qr_designs', $id))]);
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        try {
            WorkspaceMutation::run($request, function () use ($request, $id): void {
                $row = DB::table('qr_designs')->where('workspace_id', UvhRequest::workspaceId($request))->where('id', $id)->lockForUpdate()->first();
                if (! $row) {
                    throw new LinkException('Diseño no encontrado.', 404);
                }
                if ($request->input('version') !== (int) $row->version) {
                    throw new LinkException('El diseño cambió. Recarga antes de eliminarlo.', 409);
                }
                DB::table('qr_designs')->where('id', $id)->delete();
            });

            return response()->json(['ok' => true]);
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }
    }
}
