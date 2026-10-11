<?php

namespace App\Http\Controllers;

use App\Exceptions\LinkException;
use App\Support\DestinationInspections;
use App\Support\OperationalMetrics;
use App\Support\UvhCrypto;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class DestinationInspectionController
{
    public function check(Request $request, int $id): JsonResponse
    {
        return $this->start($request, $id);
    }

    public function preview(Request $request): JsonResponse
    {
        return $this->start($request, null);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        try {
            return response()->json(['inspection' => DestinationInspections::present(DestinationInspections::find($request, $id))])->header('Cache-Control', 'no-store, private');
        } catch (LinkException $error) {
            return response()->json(['error' => $error->getMessage()], $error->status);
        }
    }

    public function icon(Request $request, string $id): Response
    {
        try {
            $row = DestinationInspections::find($request, $id);
            if ($row->status !== 'ready' || ! is_string($row->icon_ciphertext) || $row->icon_ciphertext === '') {
                throw new LinkException('Icono no disponible.', 404);
            }
            $icon = base64_decode(UvhCrypto::decryptAtRest($row->icon_ciphertext), true);
            if (! is_string($icon)) {
                throw new LinkException('Icono no disponible.', 404);
            }

            return response($icon)->header('Content-Type', 'image/png')->header('Cache-Control', 'no-store, private')->header('X-Content-Type-Options', 'nosniff');
        } catch (LinkException $error) {
            return response()->json(['error' => $error->getMessage()], $error->status);
        }
    }

    private function start(Request $request, ?int $id): JsonResponse
    {
        $allowed = $id === null ? ['url'] : ['linkVersion'];
        if (array_diff(array_keys($request->all()), $allowed) !== []) {
            return response()->json(['error' => 'La solicitud contiene campos no admitidos.'], 422);
        }
        try {
            $inspection = DestinationInspections::create($request, $id);

            return response()->json(['inspection' => $inspection], $inspection['status'] === 'pending' ? 202 : 200)->header('Cache-Control', 'no-store, private');
        } catch (LinkException $error) {
            if ($error->status === 429) {
                OperationalMetrics::increment('destination_inspection.rate_limited');
            }

            return response()->json(['error' => $error->getMessage()], $error->status);
        }
    }
}
