<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

final class RecoveryCommandAdmission
{
    public function handle(Request $request, LocalRecoveryBridge $bridge, string $action): JsonResponse
    {
        $allowed = ['check', 'preflight', 'install', 'backup', 'verify', 'restore', 'restore-selective', 'resume', 'policy', 'destination', 'destination-test', 'delete', 'protect', 'reconcile'];
        if (! in_array($action, $allowed, true)) {
            return response()->json(['error' => 'Operación no válida.'], 404);
        }
        $target = $request->input('target', []);
        $id = UvhRequest::inputString($request, 'requestId');
        if (! Str::isUuid($id) || ! is_array($target) || strlen(json_encode($target, JSON_THROW_ON_ERROR)) > 4096
            || array_diff(array_keys($target), ['sha', 'id', 'paths', 'withoutPreventive', 'tag', 'daily', 'dailyRetention', 'weeklyRetention', 'updateRetention', 'backupDir', 'name', 'type', 'path', 'endpoint', 'bucket', 'region', 'prefix', 'accessKey', 'secretKey', 'enabled', 'protected']) !== []) {
            return response()->json(['error' => 'Solicitud local no válida.'], 422);
        }
        try {
            $snapshot = $bridge->snapshot();
            if (! in_array($action, ['check', 'preflight'], true)) {
                $result = app(RecoveryAuthorization::class)->authorize($request, $action);
                if ($result !== null) {
                    return $result;
                }
            }
            // A retry of an admitted operation never creates a second side effect.
            foreach ([$snapshot['operation'] ?? null, ...($snapshot['history'] ?? [])] as $operation) {
                if (($operation['requestId'] ?? null) === $id) {
                    if (($operation['action'] ?? null) !== $action || ($operation['target'] ?? []) != $target) {
                        return response()->json(['error' => 'La petición pertenece a otra operación.'], 409);
                    }

                    return response()->json(['operation' => $operation], 202);
                }
            }
            if (in_array($action, ['check', 'preflight'], true)) {
                DB::transaction(fn () => Audit::write(UvhRequest::user($request)->id, 'admin.recovery.requested', 'local_operation', $id, ['action' => $action], UvhRequest::ip($request)));
            }
            $bridge->enqueue($id, UvhRequest::user($request)->id, $action, $target);

            return response()->json(['requestId' => $id, 'status' => 'queued'], 202)->header('Cache-Control', 'no-store');
        } catch (Throwable) {
            return response()->json(['error' => 'No se pudo entregar la operación al controlador. Consulta el resultado antes de repetirla.'], 503);
        }
    }
}
