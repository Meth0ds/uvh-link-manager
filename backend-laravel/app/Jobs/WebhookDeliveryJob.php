<?php

namespace App\Jobs;

use App\Support\WebhookService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Support\Facades\DB;

/**
 * Entrega de webhook fuera del request para no bloquear la respuesta HTTP.
 * Con QUEUE_CONNECTION=sync (tests) se ejecuta inline; en desarrollo con la
 * cola database lo procesa el worker `php artisan queue:work`.
 */
class WebhookDeliveryJob implements ShouldQueue
{
    use Dispatchable;
    use Queueable;

    /** Infrastructure failures are distinct from receiver delivery attempts. */
    public int $tries = 5;

    public int $timeout = 30;

    /** @var array<int, int> */
    public array $backoff = [10, 30, 60, 180];

    public function __construct(public int $deliveryId)
    {
    }

    public function handle(): void
    {
        WebhookService::attempt($this->deliveryId);
    }

    public function failed(\Throwable $exception): void
    {
        // If the worker died after claiming the row, make it discoverable by
        // housekeeping without waiting for the ten-minute stale-claim window.
        // The event_id is stable, so receivers can deduplicate at-least-once
        // delivery when the external request succeeded but persistence failed.
        try {
            DB::table('webhook_deliveries')
                ->where('id', $this->deliveryId)
                ->where('status', 'processing')
                ->update([
                    'status' => 'pending',
                    'locked_at' => null,
                    'next_attempt_at' => now()->addMinute(),
                    'last_error' => 'La infraestructura de entrega no estuvo disponible',
                ]);
        } catch (\Throwable) {
            // Housekeeping remains the final recovery path when the database
            // itself is unavailable during the failed-job callback.
        }
    }
}
