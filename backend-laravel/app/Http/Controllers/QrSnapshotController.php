<?php

namespace App\Http\Controllers;

use App\Models\Link;
use App\Support\LinkService;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class QrSnapshotController
{
    public function index(Request $request): JsonResponse
    {
        $raw = $request->query('ids');
        if (! is_string($raw) || strlen($raw) > 2200 || ! preg_match('/^[1-9][0-9]*(?:,[1-9][0-9]*){0,99}$/D', $raw)) {
            return response()->json(['error' => 'Selecciona entre 1 y 100 enlaces únicos.'], 422);
        }
        $parts = explode(',', $raw);
        $ids = [];
        foreach ($parts as $part) {
            if (strlen($part) > 16 || (float) $part > 9007199254740991) {
                return response()->json(['error' => 'Identificador de enlace inválido.'], 422);
            }
            $ids[] = (int) $part;
        }
        if (count(array_unique($ids)) !== count($ids)) {
            return response()->json(['error' => 'Hay enlaces repetidos en la selección.'], 422);
        }
        $rows = Link::with('domain')->where('workspace_id', UvhRequest::workspaceId($request))->whereNull('deleted_at')->whereIn('id', $ids)->get()->keyBy('id');
        if ($rows->count() !== count($ids)) {
            return response()->json(['error' => 'Algún enlace ya no está disponible en este workspace. Actualiza la selección.'], 404);
        }

        return response()->json(['links' => array_map(function (int $id) use ($rows): array {
            $row = $rows[$id];

            return ['id' => $id, 'alias' => $row->alias, 'shortUrl' => LinkService::shortUrl($row->domain?->domain, $row->alias), 'state' => $row->state];
        }, $ids)])->header('Cache-Control', 'private, no-store');
    }
}
