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
 * controls — but the *choice* of what to keep must not be an artefact of arrival
 * order. Two rounds of that were found here: first a value that became dominant
 * later in the day was invisible for the rest of it while a value seen once held
 * its slot for ever, and then — once the newcomer was admitted against a tie at
 * one occurrence — a map whose slots were all held by values seen *twice* froze
 * completely, so a late arrival could never reach the second occurrence that
 * would have admitted it. These tests pin the rule that replaced both, the two
 * invariants it keeps — a count is exactly what was observed, never an estimate,
 * and a value is evicted only as one of the least frequent — and the counter
 * that makes the loss visible.
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
        // The newcomer is admitted against a value tied at one occurrence, so the
        // first values to arrive are the ones traded away. Which one of the tied
        // values gives up its slot is the storage order — jsonb reorders keys,
        // so no claim is made that it is the oldest arrival — but a value that
        // has been seen twice is never the one that goes.
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
        // places with a tied one instead of being turned away, and the map is
        // left full rather than one short.
        $referrers = $this->rollup()->referrers;
        $this->assertCount(10, $referrers);
        $this->assertArrayNotHasKey('floor1.example', $referrers);
        $this->assertArrayHasKey('floor11.example', $referrers);
        $this->assertSame(1, $this->dropped());
    }

    public function test_a_value_that_becomes_frequent_late_is_not_shut_out_by_an_early_tie(): void
    {
        $cap = (int) config('uvh.analytics.max_map_keys');
        // A map in which every slot is held by a value seen twice. No slot can be
        // freed by the tie-at-one rule, so this is the state in which a newcomer
        // used to be turned away for the rest of the day: it was never in the
        // map, so every one of its visits was read as a first occurrence and
        // dropped against the same minimum of two.
        foreach (range(1, $cap) as $index) {
            AnalyticsService::recordClick($this->linkId, $this->meta("early{$index}.example"));
            AnalyticsService::recordClick($this->linkId, $this->meta("early{$index}.example"));
        }

        // The same value again and again: not a hundred values, one.
        for ($visit = 0; $visit < 100; $visit++) {
            AnalyticsService::recordClick($this->linkId, $this->meta('late.example'));
        }

        $referrers = $this->rollup()->referrers;
        $this->assertCount($cap, $referrers);
        $this->assertArrayHasKey('late.example', $referrers);
        // The count is the whole point: the value is not merely mentioned, it
        // overtook the values whose traffic had stopped.
        $this->assertSame(100, $referrers['late.example']);
    }

    public function test_a_flood_of_unique_values_cannot_inflate_the_counts_it_forces_in(): void
    {
        $cap = (int) config('uvh.analytics.max_map_keys');
        // Every value here is chosen by the visitor and sent exactly once. An
        // estimator that admits a newcomer with the count of the slot it takes
        // (`Space-Saving`) would report this flood as heavy traffic and, worse,
        // write the inflated numbers into the link owner's own export. Counts
        // stay below what was observed instead of above it, and the flood buys
        // no extra room either: it recycles the one slot its minimum holds.
        foreach (range(1, $cap * 3) as $index) {
            AnalyticsService::recordClick($this->linkId, $this->meta("flood{$index}.example"));
        }

        $referrers = $this->rollup()->referrers;
        $this->assertCount($cap, $referrers);
        $this->assertSame([], array_filter($referrers, static fn (int $count): bool => $count > 1));
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
