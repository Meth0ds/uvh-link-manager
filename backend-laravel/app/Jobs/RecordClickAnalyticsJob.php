<?php

namespace App\Jobs;

use App\Support\AnalyticsService;
use App\Support\OperationalMetrics;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;

/**
 * Persist redirect analytics away from the latency-critical 302 response.
 *
 * The payload contains only bounded dimensions and a daily pseudonym; raw IP
 * addresses and user agents never enter the queue. AnalyticsService uses the
 * event UUID as an idempotency key because a queue may deliver a job twice.
 */
class RecordClickAnalyticsJob implements ShouldQueue
{
    use Dispatchable;
    use Queueable;

    public int $tries = 5;

    public int $timeout = 30;

    public bool $failOnTimeout = true;

    /** @var array<int, int> */
    public array $backoff = [5, 30, 120, 300];

    /**
     * @param  array{country: ?string, device: ?string, browser: ?string, os: ?string, referrer_domain: ?string, campaign: ?string, visitor_hash: ?string}  $meta
     */
    public function __construct(
        public readonly string $eventId,
        public readonly int $linkId,
        public readonly string $occurredAt,
        public readonly array $meta,
    ) {
        $this->onQueue('analytics');
    }

    public function handle(): void
    {
        AnalyticsService::recordClick($this->linkId, $this->meta, $this->eventId, $this->occurredAt);
    }

    public function failed(\Throwable $exception): void
    {
        // Analytics is deliberately non-authoritative for redirect limits.
        // Expose exhausted persistence without logging the dimension payload.
        OperationalMetrics::increment('analytics.record_failed');
    }
}
