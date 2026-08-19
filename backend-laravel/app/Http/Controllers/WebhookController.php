<?php

namespace App\Http\Controllers;

use App\Models\Webhook;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\UrlUtil;
use App\Support\UvhCrypto;
use App\Support\UvhRequest;
use App\Support\WebhookService;
use Illuminate\Http\Request;

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

        $webhook = Webhook::create([
            'workspace_id' => $workspaceId,
            'url' => $url,
            'secret' => UvhCrypto::encryptAtRest($plainSecret),
            'events' => array_values($events),
            'active' => true,
        ]);

        Audit::write($user->id, 'webhook.create', 'webhook', $webhook->id, ['url' => $url], UvhRequest::ip($request));

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

        $webhook->update([
            'url' => $url !== null ? (string) $url : $webhook->url,
            'events' => $events !== null ? array_values((array) $events) : $webhook->events,
            'active' => $active !== null ? (bool) $active : $webhook->active,
            'secret' => is_string($secret) && $secret !== '' ? UvhCrypto::encryptAtRest($secret) : $webhook->secret,
            'updated_at' => now(),
        ]);

        Audit::write($user->id, 'webhook.update', 'webhook', $id, null, UvhRequest::ip($request));

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

        $webhook->delete();
        Audit::write($user->id, 'webhook.delete', 'webhook', $id, null, UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function deliveries(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);

        $webhook = Webhook::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $webhook) {
            return response()->json(['error' => 'Webhook no encontrado'], 404);
        }

        $deliveries = $webhook->deliveries()->orderByDesc('created_at')->limit(50)->get()->map(fn ($d) => [
            'id' => $d->id,
            'webhook_id' => $d->webhook_id,
            'event' => $d->event,
            'event_id' => $d->event_id,
            'payload' => json_encode($d->payload, JSON_UNESCAPED_UNICODE),
            'status' => $d->status,
            'attempts' => (int) $d->attempts,
            'last_error' => $d->last_error,
            'next_attempt_at' => $this->iso($d->next_attempt_at),
            'created_at' => $this->iso($d->created_at),
            'delivered_at' => $this->iso($d->delivered_at),
        ]);

        return response()->json(['deliveries' => $deliveries]);
    }

    public function resend(Request $request, int $id, int $deliveryId)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $webhook = Webhook::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $webhook) {
            return response()->json(['error' => 'Webhook no encontrado'], 404);
        }

        $delivery = $webhook->deliveries()->where('id', $deliveryId)->first();
        if (! $delivery) {
            return response()->json(['error' => 'Entrega no encontrada'], 404);
        }

        WebhookService::resend($deliveryId);
        Audit::write($user->id, 'webhook.resend', 'webhook', $id, ['deliveryId' => $deliveryId], UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function test(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $webhook = Webhook::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $webhook) {
            return response()->json(['error' => 'Webhook no encontrado'], 404);
        }

        $eventId = Ids::randomToken(16);
        $delivery = $webhook->deliveries()->create([
            'event' => 'ping',
            'event_id' => $eventId,
            'payload' => ['event' => 'ping', 'event_id' => $eventId, 'timestamp' => now()->toIso8601String(), 'data' => ['message' => 'UVH webhook test']],
            'status' => 'pending',
            'next_attempt_at' => now(),
        ]);

        WebhookService::resend($delivery->id);

        return response()->json(['ok' => true]);
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
