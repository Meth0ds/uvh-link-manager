<?php

namespace Tests\Feature;

use App\Support\HttpLatency;
use App\Support\OperationalMetrics;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class HttpLatencyTest extends TestCase
{
    public function test_latency_buckets_keep_preparation_and_streaming_separate(): void
    {
        DB::table('operational_metrics')->delete();
        HttpLatency::observe('prepare', 100000000);
        HttpLatency::observe('stream', 3000000000);
        $totals = OperationalMetrics::totals();
        $this->assertSame(0, $totals['http.prepare_le_50']);
        $this->assertSame(1, $totals['http.prepare_le_100']);
        $this->assertSame(0, $totals['http.stream_le_2000']);
        $this->assertSame(1, $totals['http.stream_le_5000']);
        $this->assertContains('uvh_http_duration_seconds_60m_sum{phase="stream"} 3', HttpLatency::prometheus($totals));
    }
}
