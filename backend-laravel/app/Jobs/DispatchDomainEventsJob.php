<?php

namespace App\Jobs;

use App\Support\DomainEvents;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Fan-out for the domain event outbox.
 *
 * Runs after the business transaction that recorded the events has committed.
 * Delivery problems stay inside the outbox (bounded retries, then history
 * only): DNS state is authoritative and is never rolled back for an observer.
 */
class DispatchDomainEventsJob implements ShouldQueue
{
    use Dispatchable;
    use Queueable;

    public int $tries = 3;

    public int $timeout = 30;

    /** @var array<int, int> */
    public array $backoff = [10, 60];

    /** @param list<int> $eventIds */
    public function __construct(public array $eventIds)
    {
        $this->onQueue('domains');
    }

    public function handle(): void
    {
        // WebhookService admits deliveries inside the caller's business
        // transaction; give it one. Each event is its own transaction so one
        // saturated backlog cannot hold the rest of the batch hostage.
        foreach ($this->eventIds as $eventId) {
            try {
                DomainEvents::deliver((int) $eventId);
            } catch (Throwable $e) {
                report($e);
            }
        }
    }

    public function failed(?Throwable $exception): void
    {
        // Leave the rows pending: the housekeeping sweep delivers them. The
        // job failing must not lose events, only delay them. Each channel
        // keeps its own schedule; the delivery claim lease recovers the row
        // this crashed job was holding.
        DB::table('domain_events')
            ->whereIn('id', $this->eventIds)
            ->whereNull('dispatched_at')
            ->update([
                'next_attempt_at' => now(),
                'notice_next_attempt_at' => now(),
            ]);
    }
}
