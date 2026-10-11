<?php

namespace App\Jobs;

use App\Support\DestinationInspections;
use App\Support\DestinationInspector;
use App\Support\OperationalMetrics;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Support\Facades\DB;

final class InspectDestinationJob implements ShouldBeEncrypted, ShouldQueue
{
    use Dispatchable;
    use Queueable;

    public int $tries = 1;

    public int $timeout = 15;

    public bool $failOnTimeout = true;

    public function __construct(public readonly string $inspectionId)
    {
        $this->onQueue('destinations');
    }

    public function handle(DestinationInspector $inspector): void
    {
        DestinationInspections::execute($this->inspectionId, $inspector);
    }

    public function failed(?\Throwable $error): void
    {
        OperationalMetrics::increment('destination_inspection.job_failed');
        DB::table('destination_inspections')->where('id', $this->inspectionId)->whereIn('status', ['pending', 'running'])->update([
            'status' => 'stale', 'url_ciphertext' => '', 'updated_at' => now(),
        ]);
    }
}
