<?php

namespace App\Http\Controllers;

use App\Support\LocalRecoveryBridge;
use App\Support\RecoveryAuthorization;
use App\Support\RecoveryCommandAdmission;
use App\Support\RecoveryOperationLookup;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

final class AdminUpdatesController
{
    public function status(LocalRecoveryBridge $bridge): JsonResponse
    {
        try {
            $snapshot = $bridge->snapshot();
            $bridge->reconcileAudit($snapshot);

            return response()->json($snapshot)->header('Cache-Control', 'no-store');
        } catch (Throwable) {
            return response()->json(['error' => 'Inicia UVH Control con recuperación local habilitada.', 'reason' => 'recovery_unavailable'], 503);
        }
    }

    public function access(Request $request, LocalRecoveryBridge $bridge): JsonResponse
    {
        try {
            $bridge->snapshot();
            $result = app(RecoveryAuthorization::class)->authorize($request, 'access');
            if ($result !== null) {
                return $result;
            }

            return response()->json(['ticket' => $bridge->ticket(UvhRequest::user($request)->id), 'expiresIn' => 60])
                ->header('Cache-Control', 'no-store');
        } catch (Throwable) {
            return response()->json(['error' => 'No se pudo autorizar el centro local. Comprueba UVH Control.'], 503);
        }
    }

    public function command(Request $request, LocalRecoveryBridge $bridge, string $action): JsonResponse
    {
        return app(RecoveryCommandAdmission::class)->handle($request, $bridge, $action);
    }

    /** Stable resource aliases for clients that consume the general backup contract. */
    public function backup(Request $request, LocalRecoveryBridge $bridge): JsonResponse
    {
        return $this->command($request, $bridge, 'backup');
    }

    public function backupDetail(LocalRecoveryBridge $bridge, string $id): JsonResponse
    {
        try {
            $backup = null;
            foreach ($bridge->snapshot()['backups'] ?? [] as $item) {
                if (is_array($item) && ($item['id'] ?? null) === $id) {
                    $backup = $item;
                    break;
                }
            }
            if ($backup === null) {
                return response()->json(['error' => 'Copia no encontrada.'], 404);
            }

            return response()->json(['backup' => $backup])->header('Cache-Control', 'no-store');
        } catch (Throwable) {
            return response()->json(['error' => 'No se pudo consultar el controlador local.'], 503);
        }
    }

    public function destinations(LocalRecoveryBridge $bridge): JsonResponse
    {
        try {
            $snapshot = $bridge->snapshot();

            return response()->json(['destinations' => $snapshot['destinations'] ?? [], 'policy' => $snapshot['policy'] ?? []])->header('Cache-Control', 'no-store');
        } catch (Throwable) {
            return response()->json(['error' => 'No se pudo consultar el controlador local.'], 503);
        }
    }

    public function backupAction(Request $request, LocalRecoveryBridge $bridge, string $id, string $action): JsonResponse
    {
        $target = $request->input('target', []);
        if (! is_array($target)) {
            return response()->json(['error' => 'Solicitud local no válida.'], 422);
        }
        $request->merge(['target' => [...$target, 'id' => $id]]);

        return $this->command($request, $bridge, $action);
    }

    public function operation(LocalRecoveryBridge $bridge, string $id): JsonResponse
    {
        try {
            $snapshot = $bridge->snapshot();
            $operation = RecoveryOperationLookup::find($snapshot, $id);
            if ($operation === null) {
                return response()->json(['error' => 'Operación no encontrada.'], 404);
            }

            return response()->json(['operation' => $operation])->header('Cache-Control', 'no-store');
        } catch (Throwable) {
            return response()->json(['error' => 'No se pudo consultar el controlador local.'], 503);
        }
    }

    public function operationEvents(Request $request, LocalRecoveryBridge $bridge, string $id): JsonResponse
    {
        try {
            $operation = RecoveryOperationLookup::find($bridge->snapshot(), $id);
            if ($operation === null) {
                return response()->json(['error' => 'Operación no encontrada.'], 404);
            }
            $cursor = max(0, (int) $request->query('cursor', 0));
            $events = RecoveryOperationLookup::events($operation, $cursor);

            return response()->json(['events' => $events, 'cursor' => $events === [] ? $cursor : $events[array_key_last($events)]['sequence']])->header('Cache-Control', 'no-store');
        } catch (Throwable) {
            return response()->json(['error' => 'No se pudo consultar el controlador local.'], 503);
        }
    }
}
