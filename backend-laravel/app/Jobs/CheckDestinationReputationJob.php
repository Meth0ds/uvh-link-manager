<?php

namespace App\Jobs;

use App\Support\DestinationReputationService;
use App\Support\OperationalMetrics;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Throwable;

/**
 * Re-analyse one link's destinations.
 *
 * Runs on its own `security` pool on purpose: it talks to a third party with a
 * hard timeout, and the pools exist so that one slow integration cannot starve
 * mail, webhooks or analytics. Nothing here serves a visitor — the decision it
 * applies is the link's state, which the redirect path already enforces.
 */
class CheckDestinationReputationJob implements ShouldQueue
{
    use Dispatchable;
    use Queueable;

    public int $tries = 3;

    public int $timeout = 30;

    public bool $failOnTimeout = true;

    /** @var array<int, int> */
    public array $backoff = [30, 120];

    public function __construct(public int $linkId)
    {
        $this->onQueue('security');
    }

    public function handle(): void
    {
        DestinationReputationService::evaluate($this->linkId);
    }

    /**
     * Exhausted retries are an availability problem, not a verdict. Record it
     * and let the next scheduled sweep pick the link up again: a link whose
     * destinations could not be checked stays exactly as it was, and is never
     * blocked for a lookup that never happened.
     */
    public function failed(?Throwable $error): void
    {
        OperationalMetrics::increment('reputation.check_failed');
    }
}
