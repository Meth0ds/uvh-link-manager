<?php

namespace App\Jobs;

use App\Support\WebhookService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;

/**
 * Entrega de webhook fuera del request para no bloquear la respuesta HTTP.
 * Con QUEUE_CONNECTION=sync (tests) se ejecuta inline; en desarrollo con la
 * cola database lo procesa el worker `php artisan queue:work`.
 */
class WebhookDeliveryJob implements ShouldQueue
{
    use Dispatchable;
    use Queueable;

    public function __construct(public int $deliveryId)
    {
    }

    public function handle(): void
    {
        WebhookService::attempt($this->deliveryId, 0);
    }
}
