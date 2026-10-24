<?php

namespace App\Http\Controllers;

use App\Support\Audit;
use App\Support\LocalRecoveryBridge;
use App\Support\MfaStepUp;
use App\Support\RecoveryOperationLookup;
use App\Support\SecurityContext;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
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
            $result = $this->authorize($request, 'access');
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
                $result = $this->authorize($request, $action);
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
        $response = $this->operation($bridge, $id);
        if ($response->getStatusCode() !== 200) {
            return $response;
        }
        $payload = $response->getData(true);
        $cursor = max(0, (int) $request->query('cursor', 0));
        $events = RecoveryOperationLookup::events($payload['operation'], $cursor);

        return response()->json(['events' => $events, 'cursor' => $events === [] ? $cursor : $events[array_key_last($events)]['sequence']])->header('Cache-Control', 'no-store');
    }

    /** Transactional role/session revalidation and fresh proof; no passwords leave Laravel. */
    private function authorize(Request $request, string $action): ?JsonResponse
    {
        $password = UvhRequest::inputString($request, 'password');
        $factor = UvhRequest::inputString($request, 'factorCode');
        if ($password === '' || strlen($password) > 72 || strlen($factor) > 24) {
            return response()->json(['error' => 'Introduce contraseña y segundo factor.'], 422);
        }
        $result = DB::transaction(function () use ($request, $password, $factor, $action): string {
            $context = SecurityContext::lock(UvhRequest::user($request), UvhRequest::sessionId($request), true);
            if ($context === null || ! $context->user->is_admin || ! $context->user->mfa_enabled || $context->user->email_verified_at === null) {
                return 'stale';
            }
            $proof = MfaStepUp::verify($context->user, $context->session, $password, $factor, true, 'local-recovery');
            if ($proof['status'] !== 'ok') {
                return $proof['status'];
            }
            if (isset($proof['recovery_codes'])) {
                $context->user->update(['recovery_codes' => $proof['recovery_codes'], 'updated_at' => $proof['verified_at']]);
            }
            Audit::write($context->user->id, 'admin.recovery.authorized', 'session', UvhRequest::sessionId($request), ['action' => $action], UvhRequest::ip($request));

            return 'ok';
        });

        return $result === 'ok' ? null : response()->json(['error' => 'No se pudo verificar la autorización. Reautentícate y vuelve a intentarlo.', 'reason' => 'recovery_step_up_required'], $result === 'locked' ? 429 : 403);
    }
}
