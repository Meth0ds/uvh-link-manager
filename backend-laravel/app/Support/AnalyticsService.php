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

        // The cap is reached. Keeping the first values that arrived made the map
        // an artefact of ordering: a referrer that became dominant late in the
        // day stayed invisible for the rest of it, while a value seen once held
        // its slot forever. The trade below keeps the map about the traffic
        // instead of about its timing, and every drop is counted, so the loss is
        // a monitoring signal rather than a silent bias.
        $minimum = min($m);
        $victim = array_search($minimum, $m, true);
        if ($minimum >= 2 || ! is_string($victim)) {
            // Every value already held has been seen more than once, so the
            // newcomer is genuinely the least frequent one: dropping it is the
            // top-N rule, and it is counted.
            OperationalMetrics::increment('analytics.map_keys_dropped');

            return $m;
        }
        // A tie at one occurrence: the oldest of the least frequent values gives
        // its slot to the newcomer, so nothing is frozen in by arrival order.
        unset($m[$victim]);
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
