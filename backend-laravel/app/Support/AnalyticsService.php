<?php

namespace App\Support;

use App\Models\MetricRollup;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AnalyticsService
{
    /**
     * Distinct values kept per dimension per day, unless overridden.
     *
     * The daily row is bounded on purpose: `referrers` is attacker-controlled
     * (any visitor can send any Referer) and an unbounded map would grow the row
     * without limit. What the cap must not do is decide *which* values survive
     * by arrival order — see `bump()`.
     *
     * The map is read by the data export, so a bounded estimate is not enough:
     * the counts are what a person reads about their own traffic, and the input
     * is a header the visitor chooses. That is why `bump()` takes
     * `Space-Saving`'s admission rule — a newcomer always takes the least
     * frequent slot — and deliberately not its estimate, which is an upper
     * bound: an over-estimating rule would let a visitor write clicks that never
     * happened into somebody else's export.
     */
    private const MAX_MAP_KEYS = 200;

    /**
     * Hard bounds on the configured cap. The default is generous for the one
     * dimension that can realistically reach it (`countries` has roughly 250
     * possible values) and the ceiling keeps a mistaken setting from turning the
     * daily row into the unbounded one the cap exists to prevent.
     */
    private const MAX_MAP_KEYS_FLOOR = 10;

    private const MAX_MAP_KEYS_CEILING = 5000;

    /**
     * @param  array{country: ?string, device: ?string, browser: ?string, os: ?string, referrer_domain: ?string, campaign: ?string, visitor_hash: ?string}  $meta
     */
    public static function recordClick(int $linkId, array $meta, ?string $eventId = null, ?string $occurredAt = null): void
    {
        $eventId ??= (string) Str::uuid();
        $now = $occurredAt !== null ? CarbonImmutable::parse($occurredAt)->utc() : CarbonImmutable::now('UTC');
        $day = $now->format('Y-m-d');

        DB::transaction(function () use ($eventId, $linkId, $meta, $now, $day): void {
            $inserted = DB::table('click_events')->insertOrIgnore([
                'event_id' => $eventId,
                'link_id' => $linkId,
                'occurred_at' => $now,
                'country' => $meta['country'] ?? null,
                'device' => $meta['device'] ?? null,
                'browser' => $meta['browser'] ?? null,
                'os' => $meta['os'] ?? null,
                'referrer_domain' => $meta['referrer_domain'] ?? null,
                'campaign' => $meta['campaign'] ?? null,
                'visitor_hash' => $meta['visitor_hash'] ?? null,
                'password_ok' => true,
            ]);
            if ($inserted !== 1) {
                // Database-backed queues use at-least-once delivery. A retry
                // after commit must not increment either event or rollup twice.
                return;
            }

            $isNewVisitor = false;
            if (! empty($meta['visitor_hash'])) {
                $isNewVisitor = DB::table('metric_unique_visitors')->insertOrIgnore([
                    'link_id' => $linkId,
                    'day' => $day,
                    'visitor_hash' => $meta['visitor_hash'],
                ]) === 1;
            }

            // PostgreSQL's conflict-safe insert creates the daily row once;
            // locking it then serializes JSON-map increments and click counts.
            DB::table('metric_rollups')->insertOrIgnore([
                'link_id' => $linkId,
                'day' => $day,
                'clicks' => 0,
                'visitors' => 0,
            ]);
            $rollup = MetricRollup::where('link_id', $linkId)->where('day', $day)->lockForUpdate()->firstOrFail();
            $rollup->update([
                'clicks' => $rollup->clicks + 1,
                'visitors' => $rollup->visitors + ($isNewVisitor ? 1 : 0),
                'countries' => self::bump($rollup->countries, $meta['country'] ?? null),
                'devices' => self::bump($rollup->devices, $meta['device'] ?? null),
                'browsers' => self::bump($rollup->browsers, $meta['browser'] ?? null),
                'os' => self::bump($rollup->os, $meta['os'] ?? null),
                'referrers' => self::bump($rollup->referrers, $meta['referrer_domain'] ?? null),
                'campaigns' => self::bump($rollup->campaigns, $meta['campaign'] ?? null),
            ]);
        });
    }

    /**
     * @param  array<string, int>|null  $map
     * @return array<string, int>
     */
    private static function bump(?array $map, ?string $key): array
    {
        $m = $map ?? [];
        if (! $key) {
            return $m;
        }
        if (isset($m[$key])) {
            $m[$key]++;

            return $m;
        }
        $cap = self::mapCap();
        if (count($m) < $cap) {
            $m[$key] = 1;

            return $m;
        }

        // The cap is reached and this value has not been recorded before — but
        // "not recorded here" is a statement about the past, and refusing the
        // value turned it into a statement about the rest of the day. A slot only
        // came free when some value had been seen exactly once, so a map whose
        // slots were all held by values seen twice was frozen: every visit of the
        // newcomer was read as a first occurrence and turned away, so it could
        // not reach the second occurrence that would have admitted it, and the
        // value that arrived early and then stopped was never displaced either.
        // Both halves of "the map is about the traffic, not about its timing"
        // failed there.
        //
        // The newcomer is therefore always admitted, and the slot it takes is
        // the least frequent one. Two properties follow, and they are what the
        // tests pin:
        //
        //  - a count is exactly the number of times the value was recorded while
        //    it held a slot: never an estimate, never decayed, and never filled
        //    in from the slot it took. `Space-Saving`'s admission rule is kept
        //    but its estimate is not, because that estimate is an upper bound and
        //    this map is read by the person it describes;
        //  - a value is evicted only as one of the least frequent values in the
        //    map at that moment, so a newcomer can never displace a value already
        //    seen more often than it.
        //
        // The price is stated rather than hidden: a bounded table cannot remember
        // what it evicted, so a value evicted between two visits starts again
        // from one. Two of its visits have to fall either side of an eviction for
        // that to matter, and the eviction only ever takes from the minimum, so a
        // value that keeps arriving climbs above that tie on its own instead of
        // being locked out of the map for the rest of the day.
        $minimum = min($m);
        // Among values that are equally frequent there is nothing to choose
        // between: the store does not preserve insertion order (jsonb reorders
        // keys), so the slot is given up by whichever the map orders first and
        // no claim is made that it is the oldest arrival.
        $victim = array_search($minimum, $m, true);
        if (is_string($victim)) {
            unset($m[$victim]);
        }
        $m[$key] = 1;
        OperationalMetrics::increment('analytics.map_keys_dropped');

        return $m;
    }

    /** The configured cap, clamped to a range the daily row can afford. */
    private static function mapCap(): int
    {
        $configured = config('uvh.analytics.max_map_keys', self::MAX_MAP_KEYS);
        if (! is_numeric($configured)) {
            return self::MAX_MAP_KEYS;
        }

        return max(self::MAX_MAP_KEYS_FLOOR, min(self::MAX_MAP_KEYS_CEILING, (int) $configured));
    }
}
