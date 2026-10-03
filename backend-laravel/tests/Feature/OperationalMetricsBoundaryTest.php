<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\OperationalMetrics;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class OperationalMetricsBoundaryTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, operational_metrics RESTART IDENTITY CASCADE');
    }

    public static function boundaries(): array
    {
        $cases = [];
        foreach (['single', 'batch'] as $method) {
            foreach (['immediate', 'commit', 'rollback'] as $boundary) {
                $cases[$method.' '.$boundary] = [$method, $boundary];
            }
        }

        return $cases;
    }

    #[DataProvider('boundaries')]
    public function test_sql_and_diagnostic_failures_never_change_business_outcome(string $method, string $boundary): void
    {
        $owner = User::factory()->create();
        $warnings = 0;
        Log::listen(static function (MessageLogged $event) use (&$warnings): void {
            if ($event->message === '[metrics] counter write unavailable') {
                $warnings++;
                throw new \RuntimeException('Fixture: metrics diagnostic unavailable');
            }
        });
        Schema::rename('operational_metrics', 'operational_metrics_unavailable');
        try {
            if ($boundary !== 'immediate') {
                DB::beginTransaction();
            }
            $owner->update(['name' => 'Confirmed boundary']);
            // A second invocation proves the recursion guard resets even when
            // the diagnostic fails. Deferred writes run only after commit.
            foreach ([1, 2] as $unused) {
                if ($method === 'single') {
                    OperationalMetrics::increment('export.cleaned');
                } else {
                    OperationalMetrics::incrementBatch(['export.cleaned' => 1, 'export.cleanup_failed' => 2]);
                }
            }
            if ($boundary === 'commit') {
                $this->assertSame(0, $warnings);
                DB::commit();
            } elseif ($boundary === 'rollback') {
                DB::rollBack();
            }
        } finally {
            while (DB::transactionLevel() > 0) {
                DB::rollBack();
            }
            Schema::rename('operational_metrics_unavailable', 'operational_metrics');
        }
        $this->assertSame($boundary === 'rollback' ? 0 : 2, $warnings);
        $this->assertSame($boundary !== 'rollback', $owner->refresh()->name === 'Confirmed boundary');
        // Restoring the backend admits counters through the same public entry.
        OperationalMetrics::increment('export.cleaned', 3);
        $this->assertSame(3, (int) DB::table('operational_metrics')->where('metric', 'export.cleaned')->sum('count'));
    }
}
