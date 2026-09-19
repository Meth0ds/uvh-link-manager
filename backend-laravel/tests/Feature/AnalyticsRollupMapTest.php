<?php

namespace Tests\Feature;

use App\Models\MetricRollup;
use App\Models\User;
use App\Support\AnalyticsService;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The daily rollup keeps a bounded set of distinct values per dimension.
 *
 * The bound is necessary — `referrers` comes straight from a header the visitor
 * controls — but the *choice* of what to keep was an artefact of arrival order:
 * once the cap was reached, a value that became dominant later in the day was
 * invisible for the rest of it while a value seen once held its slot forever.
 * These tests pin the rule that replaced it, and the counter that makes the loss
 * visible.
 */
final class AnalyticsRollupMapTest extends TestCase
{
    private int $linkId;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, workspaces, memberships, quotas, links, click_events, metric_rollups, metric_unique_visitors, operational_metrics RESTART IDENTITY CASCADE');

        $userId = User::factory()->create()->id;
        $workspaceId = DB::table('workspaces')->insertGetId([
            'name' => 'Analytics QA',
            'slug' => 'analytics-qa',
            'owner_user_id' => $userId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->linkId = DB::table('links')->insertGetId([
            'workspace_id' => $workspaceId,
            'created_by' => $userId,
            'alias' => 'rollup-map',
            'destination' => 'https://example.org/rollup',
            'state' => 'active',
            'version' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_a_full_map_keeps_the_frequent_values_and_evicts_the_rare_ones(): void
    {
        $cap = (int) config('uvh.analytics.max_map_keys');
        $this->assertSame(200, $cap);

        // Two more values than the map can hold.
        foreach (range(1, $cap + 2) as $index) {
            AnalyticsService::recordClick($this->linkId, $this->meta("ref{$index}.example"));
        }

        $referrers = $this->rollup()->referrers;
        $this->assertCount($cap, $referrers);
        // The first values to arrive were the ones traded away, not the ones
        // that arrived late: the map is about the traffic, not about its timing.
        $this->assertArrayNotHasKey('ref1.example', $referrers);
        $this->assertArrayNotHasKey('ref2.example', $referrers);
        $this->assertArrayHasKey("ref{$cap}.example", $referrers);
        $this->assertArrayHasKey('ref'.($cap + 2).'.example', $referrers);
        // Every eviction is counted, so the loss is a monitoring signal.
        $this->assertSame(2, $this->dropped());

        // A value that proves itself survives the next eviction: it reaches two
        // clicks, and a value seen twice is never traded for a newcomer.
        AnalyticsService::recordClick($this->linkId, $this->meta('ref3.example'));
        AnalyticsService::recordClick($this->linkId, $this->meta('ref'.($cap + 3).'.example'));

        $referrers = $this->rollup()->referrers;
        $this->assertCount($cap, $referrers);
        $this->assertSame(2, $referrers['ref3.example']);
        $this->assertArrayHasKey('ref'.($cap + 3).'.example', $referrers);
        $this->assertSame(3, $this->dropped());
    }

    public function test_a_configuration_below_the_floor_cannot_throttle_the_map(): void
    {
        // The floor exists so a mistaken setting cannot quietly turn the rollup
        // into a two-value summary; the clamp lives in code, not in the
        // operator's hands.
        config(['uvh.analytics.max_map_keys' => 2]);

        foreach (range(1, 11) as $index) {
            AnalyticsService::recordClick($this->linkId, $this->meta("floor{$index}.example"));
        }

        // Ten is the floor, not the configured two: the eleventh value traded
        // places with the oldest tied one instead of being turned away.
        $referrers = $this->rollup()->referrers;
        $this->assertCount(10, $referrers);
        $this->assertArrayNotHasKey('floor1.example', $referrers);
        $this->assertArrayHasKey('floor11.example', $referrers);
        $this->assertSame(1, $this->dropped());
    }

    /** @return array<string, string|null> */
    private function meta(string $referrer): array
    {
        return [
            'country' => null,
            'device' => null,
            'browser' => null,
            'os' => null,
            'referrer_domain' => $referrer,
            'campaign' => null,
            'visitor_hash' => null,
        ];
    }

    private function rollup(): MetricRollup
    {
        return MetricRollup::where('link_id', $this->linkId)->firstOrFail();
    }

    private function dropped(): int
    {
        return (int) DB::table('operational_metrics')
            ->where('metric', 'analytics.map_keys_dropped')
            ->sum('count');
    }
}
