<?php

namespace App\Jobs;

use App\Support\Audit;
use App\Support\Ids;
use App\Support\MailDeliveryEligibility;
use App\Support\MailLifecycleCompensator;
use App\Support\MailOutboxCompensation;
use App\Support\OperationalMetrics;
use App\Support\UvhCrypto;
use App\Support\UvhMail;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Delivers one durable outbox row. Delivery is intentionally at-least-once:
 * a worker dying after provider acceptance but before the `sent` update may
 * resend, while never silently losing a security or lifecycle message.
 */
final class DeliverMailOutboxJob implements ShouldQueue
{
    use Dispatchable;
    use Queueable;

    /** Infrastructure failures before a durable state transition may retry. */
    public int $tries = 3;

    /** @var array<int, int> */
    public array $backoff = [60, 300];

    public int $timeout = 90;

    public function __construct(public readonly int $outboxId)
    {
        $this->onQueue('mail');
    }

    public function handle(): void
    {
        $lockToken = Ids::sha256Hex(Ids::randomToken(32));
        $row = DB::transaction(function () use ($lockToken): ?object {
            $candidate = DB::table('mail_outbox')->where('id', $this->outboxId)->lockForUpdate()->first();
            if (! $candidate || ! in_array($candidate->status, ['queued', 'pending'], true)) {
                return null;
            }
            if ($candidate->status === 'pending' && Carbon::parse((string) $candidate->available_at)->isFuture()) {
                return null;
            }
            $attempts = min(100, (int) $candidate->attempts + 1);
            DB::table('mail_outbox')->where('id', $this->outboxId)->update([
                'status' => 'processing',
                'attempts' => $attempts,
                'queued_at' => null,
                'locked_at' => now(),
                'lock_token' => $lockToken,
                'last_error' => null,
                'updated_at' => now(),
            ]);
            $candidate->attempts = $attempts;

            return $candidate;
        });

        if (! $row) {
            return;
        }

        try {
            $eligible = MailDeliveryEligibility::isCurrent($row);
        } catch (\Throwable) {
            // A database outage while checking a bearer must fail closed and
            // follow the normal retry path; it must never be sent on doubt.
            $eligible = null;
        }
        if ($eligible === false) {
            $updated = DB::table('mail_outbox')
                ->where('id', $this->outboxId)->where('status', 'processing')
                ->where('lock_token', $lockToken)->update([
                    'status' => 'obsolete',
                    'encrypted_envelope' => '',
                    'locked_at' => null,
                    'lock_token' => null,
                    'last_error' => 'lifecycle_obsolete',
                    'updated_at' => now(),
                ]);
            if ($updated === 1) {
                OperationalMetrics::increment('mail.obsolete');
            }

            return;
        }

        $delivered = false;
        $errorCode = $eligible === null ? 'eligibility_unavailable' : 'invalid_envelope';
        try {
            if ($eligible === null) {
                throw new \RuntimeException('Mail lifecycle check unavailable');
            }
            $json = UvhCrypto::decryptAtRest((string) $row->encrypted_envelope);
            $message = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
            if (! is_array($message)
                || ! is_string($message['to'] ?? null)
                || ! is_string($message['subject'] ?? null)
                || ! is_string($message['html'] ?? null)
                || ! is_string($message['text'] ?? null)) {
                throw new \RuntimeException('Invalid encrypted mail envelope');
            }
            $errorCode = 'transport_unavailable';
            $delivered = UvhMail::sendNow($message['to'], $message['subject'], $message['html'], $message['text']);
        } catch (\Throwable) {
            // Never copy decrypted fields or bearer URLs into job exceptions.
            $delivered = false;
        }

        if ($delivered) {
            $updated = DB::table('mail_outbox')
                ->where('id', $this->outboxId)
                ->where('status', 'processing')
                ->where('lock_token', $lockToken)
                ->update([
                    'status' => 'sent',
                    // Delivery metadata is useful operationally; recipient,
                    // content and bearer URL are not needed after acceptance.
                    'encrypted_envelope' => '',
                    'locked_at' => null,
                    'lock_token' => null,
                    'sent_at' => now(),
                    'last_error' => null,
                    'updated_at' => now(),
                ]);
            if ($updated === 1) {
                OperationalMetrics::increment('mail.sent');
            }

            return;
        }

        $terminal = (int) $row->attempts >= 5;
        $requiresCompensation = $terminal && MailLifecycleCompensator::supports(
            (string) $row->kind,
            is_string($row->resource_type) ? $row->resource_type : null,
            is_string($row->resource_id) ? $row->resource_id : null,
            is_string($row->resource_generation) ? $row->resource_generation : null,
        );
        $updated = DB::table('mail_outbox')
            ->where('id', $this->outboxId)
            ->where('status', 'processing')
            ->where('lock_token', $lockToken)
            ->update([
                'status' => $requiresCompensation ? 'comp_pending' : ($terminal ? 'failed' : 'pending'),
                'available_at' => $terminal ? now() : now()->addSeconds($this->retryDelay((int) $row->attempts)),
                'locked_at' => null,
                'lock_token' => null,
                'failed_at' => $terminal ? now() : null,
                'last_error' => $requiresCompensation ? 'compensation_pending' : $errorCode,
                'updated_at' => now(),
            ]);

        if ($updated !== 1) {
            return;
        }
        OperationalMetrics::increment($terminal ? 'mail.failed' : 'mail.retry_scheduled');
        if (! $terminal) {
            return;
        }

        if ($requiresCompensation) {
            OperationalMetrics::increment('mail.compensation_pending');
            MailOutboxCompensation::attempt($this->outboxId);

            return;
        }

        try {
            Audit::write(null, 'mail.delivery_failed', is_string($row->resource_type) ? $row->resource_type : 'mail', $row->resource_id, [
                'kind' => (string) $row->kind,
                'outbox_id' => $this->outboxId,
            ]);
        } catch (\Throwable) {
            // The terminal outbox state is authoritative if audit is down.
        }
        Log::error('[mail] outbox delivery exhausted retries', [
            'outbox_id' => $this->outboxId,
            'kind' => (string) $row->kind,
        ]);
    }

    private function retryDelay(int $attempt): int
    {
        return match ($attempt) {
            1 => 60,
            2 => 300,
            3 => 900,
            default => 1800,
        };
    }
}
