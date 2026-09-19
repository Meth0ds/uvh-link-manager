<?php

namespace App\Jobs;

use App\Support\DestinationReputationService;
use App\Support\OperationalMetrics;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Throwable;

/**
 * Finish a destination block whose propagation stopped at its budget.
 *
 * Blocking a host has to reach the links that already point at it, and the
 * redirect path deliberately never consults the denylist per click: the state of
 * those links *is* the decision. That makes a partially propagated block a hole
 * that stays open — the links beyond the budget keep serving.
 *
 * The first call is bounded so an operator's request cannot walk a table, and
 * this job carries the cursor forward until the host has no links left. It runs
 * on the `security` pool next to the other reputation work, and it is queued
 * even when no reputation provider is configured, because the denylist is a
 * local decision that must not depend on an optional third party.
 *
 * A failure here is reported and the next scheduled sweep is a backstop, but it
 * is not silent: `reputation.check_failed` and the request's
 * `linksSweepTruncated` both point at it.
 */
class ContinueDestinationSweepJob implements ShouldQueue
{
    use Dispatchable;
    use Queueable;

    public int $tries = 3;

    public int $timeout = 60;

    public bool $failOnTimeout = true;

    /** @var array<int, int> */
    public array $backoff = [30, 120];

    public function __construct(public string $host, public int $afterId)
    {
        $this->onQueue('security');
    }

    public function handle(): void
    {
        // The service re-dispatches this job itself while the sweep is still
        // truncated, so the whole chain is one bounded batch per job and the
        // cursor is the only state that has to survive between them.
        DestinationReputationService::reanalyzeHost($this->host, null, $this->afterId);
    }

    public function failed(?Throwable $error): void
    {
        OperationalMetrics::increment('reputation.sweep_continuation_failed');
    }
}
