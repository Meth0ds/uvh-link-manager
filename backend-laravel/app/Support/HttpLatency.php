<?php

namespace App\Support;

final class HttpLatency
{
    public const BOUNDS = [50, 100, 250, 500, 1000, 2000, 5000];

    public static function observe(string $phase, int $nanoseconds): void
    {
        if (! in_array($phase, ['prepare', 'stream'], true)) {
            return;
        }
        $ms = max(0, min(600000, (int) round($nanoseconds / 1000000)));
        $counts = [];
        foreach (self::BOUNDS as $bound) {
            if ($ms <= $bound) {
                $counts['http.'.$phase.'_le_'.$bound] = 1;
            }
        }
        $counts['http.'.$phase.'_le_inf'] = 1;
        $counts['http.'.$phase.'_duration_ms'] = $ms;
        OperationalMetrics::incrementBatch($counts);
    }

    /** Rolling-window cumulative buckets are gauges, never monotonic counters. */
    /**
     * @param  array<string, int>  $totals
     * @return list<string>
     */
    public static function prometheus(array $totals): array
    {
        $lines = ['# TYPE uvh_http_duration_seconds_60m_bucket gauge',
            '# TYPE uvh_http_duration_seconds_60m_count gauge', '# TYPE uvh_http_duration_seconds_60m_sum gauge'];
        foreach (['prepare', 'stream'] as $phase) {
            foreach ([...self::BOUNDS, 'inf'] as $bound) {
                $label = $bound === 'inf' ? '+Inf' : (string) ($bound / 1000);
                $lines[] = 'uvh_http_duration_seconds_60m_bucket{phase="'.$phase.'",le="'.$label.'"} '.($totals['http.'.$phase.'_le_'.$bound] ?? 0);
            }
            $lines[] = 'uvh_http_duration_seconds_60m_count{phase="'.$phase.'"} '.($totals['http.'.$phase.'_le_inf'] ?? 0);
            $lines[] = 'uvh_http_duration_seconds_60m_sum{phase="'.$phase.'"} '.(($totals['http.'.$phase.'_duration_ms'] ?? 0) / 1000);
        }

        return $lines;
    }
}
