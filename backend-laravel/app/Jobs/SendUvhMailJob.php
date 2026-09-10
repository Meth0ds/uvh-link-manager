<?php

namespace App\Jobs;

use App\Support\Audit;
use App\Support\MailDeliveryEligibility;
use App\Support\MailLifecycleCompensator;
use App\Support\UvhCrypto;
use App\Support\UvhMail;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Support\Facades\Log;

/**
 * Sends a transactional email outside the request with bounded retries.
 *
 * The sensitive message envelope is encrypted at rest. Optional lifecycle
 * identifiers contain only a resource type, numeric identifier and optional
 * one-way generation digest so an exhausted delivery can compensate exactly
 * the originating state without exposing recipients or bearer credentials.
 */
class SendUvhMailJob implements ShouldQueue
{
    use Dispatchable;
    use Queueable;

    public int $tries = 5;

    /** Stay below the dedicated mail worker's 120-second hard timeout. */
    public int $timeout = 90;

    public bool $failOnTimeout = true;

    /** @var array<int, int> */
    public array $backoff = [60, 300, 900, 1800];

    public function __construct(
        public readonly string $encryptedEnvelope,
        public readonly string $kind,
        public readonly ?string $resourceType = null,
        public readonly int|string|null $resourceId = null,
        public readonly ?string $resourceGeneration = null,
    ) {
        // Legacy encrypted-envelope jobs share the same latency-sensitive pool
        // as the durable outbox dispatcher during rolling upgrades.
        $this->onQueue('mail');
    }

    public function handle(): void
    {
        try {
            // Jobs admitted before the durable-outbox migration may still be
            // present during a rolling deployment. Revalidate their lifecycle
            // before decrypting or sending so an expired/revoked bearer cannot
            // be delivered merely because an old queue was restored.
            $eligible = MailDeliveryEligibility::isCurrent((object) [
                'kind' => $this->kind,
                'resource_type' => $this->resourceType,
                'resource_id' => $this->resourceId !== null ? (string) $this->resourceId : null,
                'resource_generation' => $this->resourceGeneration,
            ]);
            if (! $eligible) {
                return;
            }

            $json = UvhCrypto::decryptAtRest($this->encryptedEnvelope);
            $message = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
            if (! is_array($message)
                || ! is_string($message['to'] ?? null)
                || ! is_string($message['subject'] ?? null)
                || ! is_string($message['html'] ?? null)
                || ! is_string($message['text'] ?? null)) {
                throw new \RuntimeException('Sobre de correo inválido');
            }

            if (! UvhMail::sendNow($message['to'], $message['subject'], $message['html'], $message['text'])) {
                throw new \RuntimeException('El transporte de correo no aceptó el mensaje');
            }
        } catch (\Throwable $e) {
            // Do not put recipient, subject or bearer URL in the failed_jobs
            // exception text. The job payload is encrypted, but failed job
            // exceptions are routinely exported to log aggregation.
            throw new \RuntimeException('No se pudo entregar correo UVH');
        }
    }

    public function failed(\Throwable $exception): void
    {
        try {
            MailLifecycleCompensator::compensate(
                $this->kind,
                $this->resourceType,
                $this->resourceId,
                $this->resourceGeneration,
            );
        } catch (\Throwable $compensationError) {
            Log::error('[mail] lifecycle compensation failed', ['kind' => $this->kind, 'exception' => $compensationError::class]);
        }
        try {
            Audit::write(null, 'mail.delivery_failed', $this->resourceType ?? 'mail', $this->resourceId, ['kind' => $this->kind]);
        } catch (\Throwable) {
            // A failed audit write must never mask the queue failure itself.
        }
        Log::error('[mail] delivery exhausted retries', ['kind' => $this->kind]);
    }
}
