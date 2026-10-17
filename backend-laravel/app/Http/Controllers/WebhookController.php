<?php

namespace App\Http\Controllers;

use App\Models\Webhook;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\IsoDate;
use App\Support\UrlUtil;
use App\Support\UvhCrypto;
use App\Support\UvhRequest;
use App\Support\WebhookEvents;
use App\Support\WebhookService;
use App\Support\WorkspaceAccess;
use App\Support\WorkspaceLimits;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class WebhookController
{
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
            || count($events) < 1 || count($events) > count(WebhookEvents::all())
            || count(array_diff($events, WebhookEvents::all())) > 0) {
            return response()->json(['error' => __('messages.error_0aa9eb7787117b')], 422);
        }

        $urlOk = UrlUtil::validateDestination($url);
        if (! $urlOk['ok']) {
            return response()->json(['error' => $urlOk['error']], 422);
        }

        if ($secret !== null && (! is_string($secret) || mb_strlen($secret) < 16 || mb_strlen($secret) > 128)) {
            return response()->json(['error' => __('messages.error_0aa9eb7787117b')], 422);
        }

        $plainSecret = is_string($secret) && $secret !== '' ? $secret : Ids::randomToken(32);

        $result = DB::transaction(function () use ($workspaceId, $user, $url, $plainSecret, $events, $request): array {
            // The shared guard enforces account -> workspace lock order and
            // rechecks both the session-era security version and live role.
            if (! $this->hasWriteAccessLocked($workspaceId, $user->id, (int) $user->security_version)) {
                return ['status' => 'forbidden'];
            }
            if (Webhook::where('workspace_id', $workspaceId)->count() >= WorkspaceLimits::limit('webhooks')) {
                return ['status' => 'limit'];
            }

            $webhook = Webhook::create([
                'workspace_id' => $workspaceId,
                'created_by' => $user->id,
                'url' => $url,
                'secret' => UvhCrypto::encryptAtRest($plainSecret),
                'events' => array_values($events),
                'active' => true,
                'config_version' => 1,
            ]);
            Audit::write($user->id, 'webhook.create', 'webhook', $webhook->id,
                ['events' => count($events)], ip: UvhRequest::ip($request), workspaceId: $workspaceId);

            return ['status' => 'created', 'webhook' => $webhook];
        });
        if ($result['status'] === 'forbidden') {
            return response()->json(['error' => __('messages.error_9d562b1245ab11')], 403);
        }
        if ($result['status'] !== 'created') {
            return response()->json(['error' => __('messages.error_de46e79ae9e652')], 429);
        }
        /** @var Webhook $webhook */
        $webhook = $result['webhook'];

        return response()->json(['webhook' => $this->dto($webhook), 'secret' => $plainSecret], 201);
    }

    public function update(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $webhook = Webhook::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $webhook) {
            return response()->json(['error' => __('messages.error_4f185028f9e466')], 404);
        }

        $url = $request->input('url');
        $events = $request->input('events');
        $active = $request->input('active');
        $secret = $request->input('secret');

        if ($url !== null && ! is_string($url)) {
            return response()->json(['error' => __('messages.error_0aa9eb7787117b')], 422);
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
            || count($events) < 1 || count($events) > count(WebhookEvents::all())
            || count(array_diff($events, WebhookEvents::all())) > 0)) {
            return response()->json(['error' => __('messages.error_0aa9eb7787117b')], 422);
        }
        if ($secret !== null && (! is_string($secret) || mb_strlen($secret) < 16 || mb_strlen($secret) > 128)) {
            return response()->json(['error' => __('messages.error_0aa9eb7787117b')], 422);
        }
        if ($active !== null && ! is_bool($active)) {
            return response()->json(['error' => __('messages.error_0aa9eb7787117b')], 422);
        }

        [$lockAcquired, $updated] = WebhookService::mutateConfiguration($id, function () use ($id, $workspaceId, $user, $url, $events, $active, $secret, $request): string {
            return DB::transaction(function () use ($id, $workspaceId, $user, $url, $events, $active, $secret, $request): string {
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

                Audit::write($user->id, 'webhook.update', 'webhook', $id, null, UvhRequest::ip($request), workspaceId: $workspaceId);

                return 'ok';
            });
        });
        if (! $lockAcquired) {
            return response()->json(['error' => __('messages.error_0202e8bffded5f')], 409);
        }
        if ($updated === 'forbidden') {
            return response()->json(['error' => __('messages.error_3a07d5c6a0cbeb')], 403);
        }
        if ($updated !== 'ok') {
            return response()->json(['error' => __('messages.error_4f185028f9e466')], 404);
        }

        return response()->json(['ok' => true]);
    }

    public function destroy(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $webhook = Webhook::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $webhook) {
            return response()->json(['error' => __('messages.error_4f185028f9e466')], 404);
        }

        [$lockAcquired, $deleted] = WebhookService::mutateConfiguration($id, function () use ($id, $workspaceId, $user, $request): string {
            return DB::transaction(function () use ($id, $workspaceId, $user, $request): string {
                if (! $this->hasWriteAccessLocked($workspaceId, $user->id, (int) $user->security_version)) {
                    return 'forbidden';
                }
                $locked = Webhook::where('id', $id)->where('workspace_id', $workspaceId)->lockForUpdate()->first();
                if (! $locked) {
                    return 'not_found';
                }
                $locked->delete();

                Audit::write($user->id, 'webhook.delete', 'webhook', $id, null, UvhRequest::ip($request), workspaceId: $workspaceId);

                return 'ok';
            });
        });
        if (! $lockAcquired) {
            return response()->json(['error' => __('messages.error_c67549b5405e82')], 409);
        }
        if ($deleted === 'forbidden') {
            return response()->json(['error' => __('messages.error_5f9d9e0d1e496a')], 403);
        }
        if ($deleted !== 'ok') {
            return response()->json(['error' => __('messages.error_4f185028f9e466')], 404);
        }

        return response()->json(['ok' => true]);
    }

    public function deliveries(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);

        $page = filter_var($request->query('page', 1), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 100000]]);
        $perPage = filter_var($request->query('perPage', 20), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 50]]);
        if ($page === false || $perPage === false) {
            return response()->json(['error' => __('messages.error_7efa41a49e5290')], 422);
        }

        $webhook = Webhook::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $webhook) {
            return response()->json(['error' => __('messages.error_4f185028f9e466')], 404);
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
        [$lockAcquired, $result] = WebhookService::mutateConfiguration($id, function () use ($workspaceId, $user, $id, $deliveryId, $request): string {
            return DB::transaction(function () use ($workspaceId, $user, $id, $deliveryId, $request): string {
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
                Audit::write($user->id, 'webhook.resend', 'webhook', $id, ['deliveryId' => $deliveryId], UvhRequest::ip($request), workspaceId: $workspaceId);

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
            return response()->json(['error' => __('messages.error_90b8d9c30acc1c')], 409);
        }
        if ($result === 'forbidden') {
            return response()->json(['error' => __('messages.error_66eb455c760afa')], 403);
        }
        if ($result === 'webhook_not_found') {
            return response()->json(['error' => __('messages.error_4f185028f9e466')], 404);
        }
        if ($result === 'full') {
            return response()->json(['error' => __('messages.error_ae3aa6a0005ac2')], 429);
        }
        if (! in_array($result, ['ok', 'already_pending'], true)) {
            return response()->json(['error' => __('messages.error_2710d805b504bb')], 404);
        }

        WebhookService::enqueueExisting($deliveryId);

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
            return response()->json(['error' => __('messages.error_6fe997bb9a5e3a')], 403);
        }
        if ($result === 'not_found') {
            return response()->json(['error' => __('messages.error_4f185028f9e466')], 404);
        }
        if ($result === 'inactive') {
            return response()->json(['error' => __('messages.error_9d47825d4c3d59')], 409);
        }
        if ($result !== 'ok') {
            return response()->json(['error' => __('messages.error_dbeabe94de3b6d')], 429);
        }

        return response()->json(['ok' => true, 'eventId' => $eventId], 202);
    }

    /**
     * Rebuild a bounded, documented preview instead of returning stored JSON.
     * Unknown keys and invalid values are dropped, so a future producer cannot
     * accidentally turn the inspector into a secret-exfiltration surface. The
     * allowlist is the shared event catalog: cross-tenant ids and future
     * internal fields cannot leak through a delivery preview either.
     */
    private function redactedPayload(mixed $payload, string $event, string $eventId): array
    {
        $source = is_array($payload) ? $payload : [];
        $data = is_array($source['data'] ?? null) ? $source['data'] : [];
        $allowed = $event === WebhookEvents::PING
            ? ['message' => 'text']
            : WebhookEvents::projection($event);
        $safeData = [];
        foreach ($allowed as $key => $type) {
            $value = $data[$key] ?? null;
            if ($type === 'integer' && is_int($value) && $value >= 0) {
                $safeData[$key] = $value;
            } elseif ($type === 'text' && is_string($value) && mb_strlen($value) <= 255
                && ! preg_match('/[\x00-\x1F\x7F]/u', $value)) {
                $safeData[$key] = $value;
            } elseif ($type === 'timestamp' && is_string($value) && strlen($value) <= 64
                && strtotime($value) !== false) {
                $safeData[$key] = $value;
            }
        }

        $timestamp = $source['timestamp'] ?? null;
        if (! is_string($timestamp) || strlen($timestamp) > 64 || strtotime($timestamp) === false) {
            $timestamp = null;
        }

        return [
            'event' => WebhookEvents::exists($event) || $event === WebhookEvents::PING ? $event : 'unknown',
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
            preg_match('/^HTTP [1-5][0-9]{2}$/', $error) === 1 => ['receiver_http', __('display.display_4ac028ee5e765c')],
            str_contains($error, 'política de red') => ['network_policy', __('display.display_9f94d703e55f95')],
            str_contains($error, 'resolver') => ['dns_resolution', __('display.display_2cb3206c445f82')],
            str_contains($error, 'serializar') => ['serialization', __('display.display_9649b19c6e5546')],
            str_contains($error, 'Configuración de webhook modificada') => ['configuration_changed', __('display.display_a3fb0df544ab74')],
            str_contains($error, 'creador ya no conserva') => ['creator_permission_revoked', __('display.display_3eb10003d2082f')],
            str_contains($error, 'infraestructura de entrega') => ['delivery_infrastructure', __('display.display_1ad248f1105414')],
            str_contains($error, 'conectar con el destino') => ['connection_failed', __('display.display_723de4cb39c956')],
            default => ['unknown_failure', __('display.display_66a1c935e5432c')],
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
        return IsoDate::format($value);
    }
}
