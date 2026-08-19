<?php

namespace App\Support;

use App\Jobs\WebhookDeliveryJob;
use App\Models\Webhook;
use App\Models\WebhookDelivery;

class WebhookService
{
    public const EVENTS = [
        'link.created',
        'link.updated',
        'link.deleted',
        'link.threshold_reached',
        'domain.verified',
    ];

    /**
     * @param  array<string, mixed>  $data
     */
    public static function dispatch(int $workspaceId, string $event, array $data): void
    {
        $webhooks = Webhook::where('workspace_id', $workspaceId)->where('active', true)->get();
        if ($webhooks->isEmpty()) {
            return;
        }

        $eventId = self::uuid();
        $payload = [
            'event' => $event,
            'event_id' => $eventId,
            'timestamp' => now()->toIso8601String(),
            'data' => $data,
        ];

        foreach ($webhooks as $webhook) {
            if (! in_array($event, $webhook->events ?? [], true)) {
                continue;
            }
            $delivery = WebhookDelivery::create([
                'webhook_id' => $webhook->id,
                'event' => $event,
                'event_id' => $eventId,
                'payload' => $payload,
                'status' => 'pending',
                'next_attempt_at' => now(),
            ]);
            // No bloquea el request; afterCommit evita enviar si la
            // transacción del caller hace rollback.
            WebhookDeliveryJob::dispatch($delivery->id)->afterCommit();
        }
    }

    public static function resend(int $deliveryId): void
    {
        $delivery = WebhookDelivery::find($deliveryId);
        if (! $delivery) {
            return;
        }
        $delivery->update(['status' => 'pending', 'last_error' => null]);
        WebhookDeliveryJob::dispatch($deliveryId)->afterCommit();
    }

    public static function attempt(int $deliveryId, int $attempt): void
    {
        $delivery = WebhookDelivery::with('webhook')->find($deliveryId);
        if (! $delivery || $delivery->status !== 'pending' || ! $delivery->webhook || ! $delivery->webhook->active) {
            return;
        }

        $url = $delivery->webhook->url;
        $secret = UvhCrypto::decryptAtRest((string) $delivery->webhook->secret);
        $payloadJson = json_encode($delivery->payload, JSON_UNESCAPED_UNICODE);
        $signature = hash_hmac('sha256', $payloadJson, $secret);

        try {
            // Guarda SSRF: esquema/puerto/credenciales validados, todas las IPs
            // resueltas deben ser públicas, fijadas en connect-time (cierra el
            // DNS-rebinding TOCTOU) y sin seguir redirecciones.
            $response = Ssrf::safeFetch($url, [
                'Content-Type: application/json',
                'X-UVH-Event: '.(string) ($delivery->payload['event'] ?? ''),
                'X-UVH-Signature: t='.(int) floor(microtime(true) * 1000).',v1='.$signature,
                'X-UVH-Event-Id: '.(string) ($delivery->payload['event_id'] ?? ''),
            ], $payloadJson);

            if ($response['ok']) {
                $delivery->update(['status' => 'success', 'delivered_at' => now()]);
                $delivery->increment('attempts');
            } else {
                self::scheduleRetry($deliveryId, $attempt, 'HTTP '.$response['status']);
            }
        } catch (\Throwable $e) {
            self::scheduleRetry($deliveryId, $attempt, $e->getMessage());
        }
    }

    private static function scheduleRetry(int $deliveryId, int $attempt, string $error): void
    {
        $next = $attempt + 1;
        if ($next > 5) {
            WebhookDelivery::where('id', $deliveryId)->update([
                'status' => 'failed',
                'last_error' => $error,
                'attempts' => $next,
            ]);

            return;
        }
        $delay = min(60_000, (2 ** ($next - 1)) * 1_000); // exponential backoff
        WebhookDelivery::where('id', $deliveryId)->update([
            'attempts' => $next,
            'last_error' => $error,
            'next_attempt_at' => now()->addMilliseconds($delay),
        ]);
    }

    private static function uuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);

        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }
}
