<?php

namespace App\Support;

use App\Models\ClickEvent;
use App\Models\Link;
use App\Models\MetricRollup;
use Illuminate\Support\Facades\DB;

class AnalyticsService
{
    private const MAX_MAP_KEYS = 200;

    /**
     * @param  array{country: ?string, device: ?string, browser: ?string, os: ?string, referrer_domain: ?string, campaign: ?string, visitor_hash: ?string}  $meta
     */
    public static function recordClick(int $linkId, array $meta): void
    {
        $now = now();
        $day = $now->format('Y-m-d');

        DB::transaction(function () use ($linkId, $meta, $now, $day): void {
            ClickEvent::create([
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
        if (! isset($m[$key]) && count($m) >= self::MAX_MAP_KEYS) {
            return $m; // drop new distinct keys beyond the cap
        }
        $m[$key] = ($m[$key] ?? 0) + 1;

        return $m;
    }
}
