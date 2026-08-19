<?php

namespace App\Support;

use App\Models\ClickEvent;
use App\Models\Link;
use App\Models\MetricRollup;

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

        $rollup = MetricRollup::where('link_id', $linkId)->where('day', $day)->first();

        if (! $rollup) {
            MetricRollup::create([
                'link_id' => $linkId,
                'day' => $day,
                'clicks' => 1,
                'visitors' => ! empty($meta['visitor_hash']) ? 1 : 0,
                'countries' => ! empty($meta['country']) ? [$meta['country'] => 1] : null,
                'devices' => ! empty($meta['device']) ? [$meta['device'] => 1] : null,
                'browsers' => ! empty($meta['browser']) ? [$meta['browser'] => 1] : null,
                'os' => ! empty($meta['os']) ? [$meta['os'] => 1] : null,
                'referrers' => ! empty($meta['referrer_domain']) ? [$meta['referrer_domain'] => 1] : null,
                'campaigns' => ! empty($meta['campaign']) ? [$meta['campaign'] => 1] : null,
            ]);
        } else {
            $rollup->update([
                'clicks' => $rollup->clicks + 1,
                'visitors' => $rollup->visitors + (! empty($meta['visitor_hash']) ? 1 : 0),
                'countries' => self::bump($rollup->countries, $meta['country'] ?? null),
                'devices' => self::bump($rollup->devices, $meta['device'] ?? null),
                'browsers' => self::bump($rollup->browsers, $meta['browser'] ?? null),
                'os' => self::bump($rollup->os, $meta['os'] ?? null),
                'referrers' => self::bump($rollup->referrers, $meta['referrer_domain'] ?? null),
                'campaigns' => self::bump($rollup->campaigns, $meta['campaign'] ?? null),
            ]);
        }

        // Threshold webhooks (link.threshold_reached).
        $link = Link::find($linkId);
        if ($link && $link->max_clicks !== null && $link->max_clicks > 0 && (int) $link->click_count === (int) $link->max_clicks) {
            WebhookService::dispatch($link->workspace_id, 'link.threshold_reached', ['linkId' => $linkId, 'threshold' => $link->max_clicks]);
        }
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
