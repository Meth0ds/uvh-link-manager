<?php

namespace App\Http\Controllers;

use App\Models\Webhook;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\UrlUtil;
use App\Support\UvhCrypto;
use App\Support\UvhRequest;
use App\Support\WebhookService;
use App\Support\WorkspaceAccess;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class WebhookController
{
    private const MAX_WEBHOOKS_PER_WORKSPACE = \App\Support\WorkspaceLimits::WEBHOOKS;

    public function index(Request $request)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $webhooks = Webhook::where('workspace_id', $workspaceId)->orderByDesc('created_at')->get()->map(fn ($w) => $this->dto($w));

        return response()->json(['webhooks' => $webhooks]);
    }

    public function store(Request $request)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $url = $request->input('url', '');
        $events = $request->input('events', []);
        $secret = $request->input('secret');

        if (! is_string($url) || ! is_array($events)
            || count(array_filter($events, fn ($event) => ! is_string($event))) > 0
            || count(array_unique($events)) !== count($events)
            || strlen($url) > 2048
            || count($events) < 1 || count($events) > 10
            || count(array_diff($events, WebhookService::EVENTS)) > 0) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $urlOk = UrlUtil::validateDestination($url);
        if (! $urlOk['ok']) {
            return response()->json(['error' => $urlOk['error']], 422);
        }

        if ($secret !== null && (! is_string($secret) || mb_strlen($secret) < 16 || mb_strlen($secret) > 128)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $plainSecret = is_string($secret) && $secret !== '' ? $secret : Ids::randomToken(32);

        $result = DB::transaction(function () use ($workspaceId, $user, $url, $plainSecret, $events): array {
            // The shared guard enforces account -> workspace lock order and
            // rechecks both the session-era security version and live role.
            if (! $this->hasWriteAccessLocked($workspaceId, $user->id, (int) $user->security_version)) {
                return ['status' => 'forbidden'];
            }
            if (Webhook::where('workspace_id', $workspaceId)->count() >= self::MAX_WEBHOOKS_PER_WORKSPACE) {
                return ['status' => 'limit'];
            }

            return ['status' => 'created', 'webhook' => Webhook::create([
                'workspace_id' => $workspaceId,
                'created_by' => $user->id,
                'url' => $url,
                'secret' => UvhCrypto::encryptAtRest($plainSecret),
                'events' => array_values($events),
                'active' => true,
                'config_version' => 1,
            ])];
        });
        if ($result['status'] === 'forbidden') {
            return response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de crear un webhook.'], 403);
        }
        if ($result['status'] !== 'created') {
            return response()->json(['error' => 'Límite de webhooks alcanzado'], 429);
        }
        /** @var Webhook $webhook */
        $webhook = $result['webhook'];

        Audit::write($user->id, 'webhook.create', 'webhook', $webhook->id, ['events' => count($events)], UvhRequest::ip($request), workspaceId: $workspaceId);

        return response()->json(['webhook' => $this->dto($webhook), 'secret' => $plainSecret], 201);
    }

    public function update(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $webhook = Webhook::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $webhook) {
            return response()->json(['error' => 'Webhook no encontrado'], 404);
        }

        $url = $request->input('url');
        $events = $request->input('events');
        $active = $request->input('active');
        $secret = $request->input('secret');

        if ($url !== null && ! is_string($url)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        if ($url !== null) {
            $urlOk = UrlUtil::validateDestination($url);
            if (! $urlOk['ok']) {
                return response()->json(['error' => $urlOk['error']], 422);
            }
        }
        if ($events !== null && (! is_array($events)
            || count(array_filter($events, fn ($event) => ! is_string($event))) > 0
            || count(array_unique($events)) !== count($events)
            || count($events) < 1 || count($events) > 10
            || count(array_diff($events, WebhookService::EVENTS)) > 0)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        if ($secret !== null && (! is_string($secret) || mb_strlen($secret) < 16 || mb_strlen($secret) > 128)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        if ($active !== null && ! is_bool($active)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        [$lockAcquired, $updated] = WebhookService::mutateConfiguration($id, function () use ($id, $workspaceId, $user, $url, $events, $active, $secret): string {
            return DB::transaction(function () use ($id, $workspaceId, $user, $url, $events, $active, $secret): string {
                if (! $this->hasWriteAccessLocked($workspaceId, $user->id, (int) $user->security_version)) {
                    return 'forbidden';
                }
                $locked = Webhook::where('id', $id)->where('workspace_id', $workspaceId)->lockForUpdate()->first();
                if (! $locked) {
                    return 'not_found';
                }
                $changed = $url !== null || $events !== null || $active !== null || (is_string($secret) && $secret !== '');
                $locked->update([
                    'url' => $url !== null ? (string) $url : $locked->url,
                    'events' => $events !== null ? array_values((array) $events) : $locked->events,
                    'active' => $active !== null ? (bool) $active : $locked->active,
                    'secret' => is_string($secret) && $secret !== '' ? UvhCrypto::encryptAtRest($secret) : $locked->secret,
                    'config_version' => $changed ? (int) $locked->config_version + 1 : $locked->config_version,
                    'updated_at' => now(),
                ]);
                if ($changed) {
                    $locked->deliveries()->where('status', 'pending')->update([
                        'status' => 'failed',
                        'last_error' => 'Configuración de webhook modificada antes de la entrega',
                    ]);
                }

                return 'ok';
            });
        });
        if (! $lockAcquired) {
            return response()->json(['error' => 'Hay una entrega en curso para este webhook. Espera unos segundos antes de modificarlo.'], 409);
        }
        if ($updated === 'forbidden') {
            return response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de modificar el webhook.'], 403);
        }
        if ($updated !== 'ok') {
            return response()->json(['error' => 'Webhook no encontrado'], 404);
        }

        Audit::write($user->id, 'webhook.update', 'webhook', $id, null, UvhRequest::ip($request), workspaceId: $workspaceId);

        return response()->json(['ok' => true]);
    }

    public function destroy(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $webhook = Webhook::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $webhook) {
            return response()->json(['error' => 'Webhook no encontrado'], 404);
        }

        [$lockAcquired, $deleted] = WebhookService::mutateConfiguration($id, function () use ($id, $workspaceId, $user): string {
            return DB::transaction(function () use ($id, $workspaceId, $user): string {
                if (! $this->hasWriteAccessLocked($workspaceId, $user->id, (int) $user->security_version)) {
                    return 'forbidden';
                }
                $locked = Webhook::where('id', $id)->where('workspace_id', $workspaceId)->lockForUpdate()->first();
                if (! $locked) {
                    return 'not_found';
                }
                $locked->delete();

                return 'ok';
            });
        });
        if (! $lockAcquired) {
            return response()->json(['error' => 'Hay una entrega en curso para este webhook. Espera unos segundos antes de eliminarlo.'], 409);
        }
        if ($deleted === 'forbidden') {
            return response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de eliminar el webhook.'], 403);
        }
        if ($deleted !== 'ok') {
            return response()->json(['error' => 'Webhook no encontrado'], 404);
        }
        Audit::write($user->id, 'webhook.delete', 'webhook', $id, null, UvhRequest::ip($request), workspaceId: $workspaceId);

        return response()->json(['ok' => true]);
    }

    public function deliveries(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);

        $page = filter_var($request->query('page', 1), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 100000]]);
        $perPage = filter_var($request->query('perPage', 20), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 50]]);
        if ($page === false || $perPage === false) {
            return response()->json(['error' => 'Paginación inválida'], 422);
        }

        $webhook = Webhook::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $webhook) {
            return response()->json(['error' => 'Webhook no encontrado'], 404);
        }

        $query = $webhook->deliveries()->orderByDesc('created_at')->orderByDesc('id');
        $total = (clone $query)->count();
        $deliveries = $query->forPage($page, $perPage)->get()->map(fn ($d) => [
            'id' => $d->id,
            'webhook_id' => $d->webhook_id,
            'event' => $d->event,
            'event_id' => $d->event_id,
            'status' => $d->status,
            'attempts' => (int) $d->attempts,
            // Never expose the persisted raw error: future transports could
            // otherwise leak a resolved host, IP address or remote body.
            'error' => $this->normalizedDeliveryError($d->last_error),
            'payloadPreview' => $this->redactedPayload($d->payload, (string) $d->event, (string) $d->event_id),
            'next_attempt_at' => $this->iso($d->next_attempt_at),
            'created_at' => $this->iso($d->created_at),
            'delivered_at' => $this->iso($d->delivered_at),
        ]);

        return response()->json([
            'deliveries' => $deliveries,
            'total' => $total,
            'page' => $page,
            'perPage' => $perPage,
        ]);
    }

    public function resend(Request $request, int $id, int $deliveryId)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        // Hold the same configuration lock used by the worker. Rewinding a
        // processing row while its HTTP request is in flight loses the result
        // and can create an avoidable duplicate delivery.
        [$lockAcquired, $result] = WebhookService::mutateConfiguration($id, function () use ($workspaceId, $user, $id, $deliveryId): string {
            return DB::transaction(function () use ($workspaceId, $user, $id, $deliveryId): string {
                if (! $this->hasWriteAccessLocked($workspaceId, $user->id, (int) $user->security_version)) {
                    return 'forbidden';
                }
                $webhook = Webhook::where('id', $id)->where('workspace_id', $workspaceId)->lockForUpdate()->first();
                if (! $webhook) {
                    return 'webhook_not_found';
                }
                $delivery = $webhook->deliveries()->where('id', $deliveryId)->lockForUpdate()->first();
                if (! $delivery) {
                    return 'delivery_not_found';
                }
                if ($delivery->status === 'processing') {
                    return 'processing';
                }
                // A pending row already consumes one backlog slot. Reserving
                // capacity again would reject an idempotent nudge when the
                // workspace is exactly at its limit.
                if ($delivery->status !== 'pending' && ! WebhookService::canRequeue($workspaceId)) {
                    return 'full';
                }
                if ($delivery->status === 'pending') {
                    $delivery->update(['next_attempt_at' => now(), 'locked_at' => null]);

                    return 'already_pending';
                }
                $delivery->update([
                    'status' => 'pending',
                    'attempts' => 0,
                    'last_error' => null,
                    'locked_at' => null,
                    'next_attempt_at' => now(),
                ]);

                return 'ok';
            });
        });
        if (! $lockAcquired || $result === 'processing') {
            return response()->json(['error' => 'La entrega está en curso. Espera a que termine antes de reenviarla.'], 409);
        }
        if ($result === 'forbidden') {
            return response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de reenviar.'], 403);
        }
        if ($result === 'webhook_not_found') {
            return response()->json(['error' => 'Webhook no encontrado'], 404);
        }
        if ($result === 'full') {
            return response()->json(['error' => 'La cola de entregas del workspace está llena. Espera antes de reenviar.'], 429);
        }
        if (! in_array($result, ['ok', 'already_pending'], true)) {
            return response()->json(['error' => 'Entrega no encontrada'], 404);
        }

        WebhookService::enqueueExisting($deliveryId);
        Audit::write($user->id, 'webhook.resend', 'webhook', $id, ['deliveryId' => $deliveryId], UvhRequest::ip($request), workspaceId: $workspaceId);

        return response()->json(['ok' => true, 'state' => 'pending']);
    }

    public function test(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $eventId = Ids::randomToken(16);
        $result = DB::transaction(function () use ($workspaceId, $user, $id, $eventId): string {
            // Keep the workspace lock until the durable delivery is admitted.
            // Member removal and webhook changes take this same parent lock.
            if (! $this->hasWriteAccessLocked($workspaceId, $user->id, (int) $user->security_version)) {
                return 'forbidden';
            }
            $webhook = Webhook::where('id', $id)->where('workspace_id', $workspaceId)->first();
            if (! $webhook) {
                return 'not_found';
            }
            if (! $webhook->active) {
                return 'inactive';
            }
            $queued = WebhookService::dispatchTest($webhook, [
                'event' => 'ping',
                'event_id' => $eventId,
                'timestamp' => now()->toIso8601String(),
                'data' => ['message' => 'UVH webhook test'],
            ]);

            return $queued ? 'ok' : 'full';
        });
        if ($result === 'forbidden') {
            return response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de probar el webhook.'], 403);
        }
        if ($result === 'not_found') {
            return response()->json(['error' => 'Webhook no encontrado'], 404);
        }
        if ($result === 'inactive') {
            return response()->json(['error' => 'Activa el webhook antes de enviar una prueba'], 409);
        }
        if ($result !== 'ok') {
            return response()->json(['error' => 'La cola de entregas del workspace está llena. Espera a que terminen las entregas pendientes.'], 429);
        }

        return response()->json(['ok' => true, 'eventId' => $eventId], 202);
    }

    /**
     * Rebuild a bounded, documented preview instead of returning stored JSON.
     * Unknown keys and invalid values are dropped, so a future producer cannot
     * accidentally turn the inspector into a secret-exfiltration surface.
     */
    private function redactedPayload(mixed $payload, string $event, string $eventId): array
    {
        $source = is_array($payload) ? $payload : [];
        $data = is_array($source['data'] ?? null) ? $source['data'] : [];
        $allowed = match ($event) {
            'link.created' => ['linkId' => 'integer', 'alias' => 'text'],
            'link.updated' => ['linkId' => 'integer', 'alias' => 'text', 'state' => 'text'],
            'link.deleted' => ['linkId' => 'integer'],
            'link.threshold_reached' => ['linkId' => 'integer', 'threshold' => 'integer'],
            'domain.verified' => ['domainId' => 'integer', 'domain' => 'text'],
            'ping' => ['message' => 'text'],
            default => [],
        };
        $safeData = [];
        foreach ($allowed as $key => $type) {
            $value = $data[$key] ?? null;
            if ($type === 'integer' && is_int($value) && $value >= 0) {
                $safeData[$key] = $value;
            } elseif ($type === 'text' && is_string($value) && mb_strlen($value) <= 255
                && ! preg_match('/[\x00-\x1F\x7F]/u', $value)) {
                $safeData[$key] = $value;
            }
        }

        $timestamp = $source['timestamp'] ?? null;
        if (! is_string($timestamp) || strlen($timestamp) > 64 || strtotime($timestamp) === false) {
            $timestamp = null;
        }

        return [
            'event' => in_array($event, array_merge(WebhookService::EVENTS, ['ping']), true) ? $event : 'unknown',
            'eventId' => mb_substr($eventId, 0, 255),
            'timestamp' => $timestamp,
            'data' => $safeData,
            'redacted' => true,
        ];
    }

    /** @return array{code: string, message: string}|null */
    private function normalizedDeliveryError(?string $error): ?array
    {
        if ($error === null || $error === '') {
            return null;
        }
        [$code, $message] = match (true) {
            preg_match('/^HTTP [1-5][0-9]{2}$/', $error) === 1 => ['receiver_http', 'El receptor devolvió una respuesta no satisfactoria.'],
            str_contains($error, 'política de red') => ['network_policy', 'El destino fue bloqueado por la política de red.'],
            str_contains($error, 'resolver') => ['dns_resolution', 'No se pudo resolver el destino.'],
            str_contains($error, 'serializar') => ['serialization', 'No se pudo preparar el evento.'],
            str_contains($error, 'Configuración de webhook modificada') => ['configuration_changed', 'La configuración cambió antes de la entrega.'],
            str_contains($error, 'creador ya no conserva') => ['creator_permission_revoked', 'El creador ya no conserva permiso de edición.'],
            str_contains($error, 'infraestructura de entrega') => ['delivery_infrastructure', 'La infraestructura de entrega no estuvo disponible.'],
            str_contains($error, 'conectar con el destino') => ['connection_failed', 'No se pudo conectar con el receptor.'],
            default => ['unknown_failure', 'La entrega no se completó.'],
        };

        return ['code' => $code, 'message' => $message];
    }

    /** Must be called inside a database transaction. */
    private function hasWriteAccessLocked(int $workspaceId, int $userId, int $expectedSecurityVersion): bool
    {
        return WorkspaceAccess::getMembershipLocked(
            $userId,
            $workspaceId,
            'editor',
            expectedSecurityVersion: $expectedSecurityVersion,
        ) !== null;
    }

    private function dto(Webhook $w): array
    {
        return [
            'id' => $w->id,
            'url' => $w->url,
            'events' => $w->events ?? [],
            'active' => (bool) $w->active,
            'hasSecret' => (bool) $w->secret,
            'createdAt' => $this->iso($w->created_at),
            'updatedAt' => $this->iso($w->updated_at),
        ];
    }

    private function iso(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        return $value instanceof \DateTimeInterface
            ? $value->format('Y-m-d\TH:i:s.v\Z')
            : (string) $value;
    }
}
