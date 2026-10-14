<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * Pure rule-selection logic shared by real redirects and simulations.
 * It deliberately knows nothing about links, sessions, counters or responses.
 */
final class RedirectRuleMatcher
{
    /**
     * @param  Collection<int, object>|array<int, object|array<string, mixed>>  $rules
     * @param  array{country?: ?string, languages?: list<string>, device?: ?string, os?: ?string, referrer?: ?string, campaign?: ?string}  $context
     * @param  array<string, ?string>  $utm
     * @return array{source: 'rule'|'fallback'|'primary', ruleIndex: ?int, ruleId: ?int, priority: ?int, destination: string, destinationWithUtm: string}
     */
    public static function evaluate(
        Collection|array $rules,
        string $destination,
        ?string $fallback,
        array $utm,
        array $context,
        CarbonImmutable $nowUtc,
    ): array {
        $country = ! empty($context['country']) ? strtolower((string) $context['country']) : null;
        $languages = $context['languages'] ?? [];
        $device = strtolower((string) ($context['device'] ?? ''));
        $os = strtolower((string) ($context['os'] ?? ''));
        $referrer = strtolower((string) ($context['referrer'] ?? ''));
        $campaign = strtolower((string) ($context['campaign'] ?? ''));
        $selected = null;
        $selectedIndex = null;

        $orderedRules = array_values($rules instanceof Collection ? $rules->all() : $rules);
        $indexedRules = [];
        foreach ($orderedRules as $index => $rule) {
            $value = is_object($rule) && method_exists($rule, 'getAttribute')
                ? ['priority' => $rule->getAttribute('priority'), 'id' => $rule->getAttribute('id')]
                : (is_object($rule) ? get_object_vars($rule) : $rule);
            $indexedRules[] = ['index' => $index, 'rule' => $rule, 'priority' => (int) ($value['priority'] ?? 0), 'id' => isset($value['id']) ? (int) $value['id'] : null];
        }
        usort($indexedRules, static function (array $left, array $right): int {
            $priority = $left['priority'] <=> $right['priority'];
            if ($priority !== 0) {
                return $priority;
            }
            if ($left['id'] !== null && $right['id'] !== null && $left['id'] !== $right['id']) {
                return $left['id'] <=> $right['id'];
            }

            return $left['index'] <=> $right['index'];
        });

        foreach ($indexedRules as $entry) {
            $index = $entry['index'];
            $rule = $entry['rule'];
            $value = is_object($rule) && method_exists($rule, 'getAttribute')
                ? array_combine(
                    ['id', 'priority', 'country', 'language', 'device', 'os', 'time_from', 'time_to', 'referrer', 'campaign', 'destination'],
                    array_map(fn (string $key): mixed => $rule->getAttribute($key), ['id', 'priority', 'country', 'language', 'device', 'os', 'time_from', 'time_to', 'referrer', 'campaign', 'destination']),
                )
                : (is_object($rule) ? get_object_vars($rule) : $rule);
            if (! empty($value['country']) && strtolower((string) $value['country']) !== $country) {
                continue;
            }
            if (! empty($value['language']) && ! self::languageMatches((string) $value['language'], $languages)) {
                continue;
            }
            if (! empty($value['device']) && strtolower((string) $value['device']) !== $device) {
                continue;
            }
            if (! empty($value['os']) && ! str_contains($os, strtolower((string) $value['os']))) {
                continue;
            }
            if (! empty($value['referrer']) && ! str_contains($referrer, strtolower((string) $value['referrer']))) {
                continue;
            }
            if (! empty($value['campaign']) && strtolower((string) $value['campaign']) !== $campaign) {
                continue;
            }
            if (! self::inTimeRange($value['time_from'] ?? null, $value['time_to'] ?? null, $nowUtc)) {
                continue;
            }
            $selected = $value;
            $selectedIndex = $index;
            break;
        }

        $source = $selected !== null ? 'rule' : ($fallback ? 'fallback' : 'primary');
        $chosen = $selected !== null ? (string) $selected['destination'] : ($fallback ?: $destination);

        return [
            'source' => $source,
            'ruleIndex' => $selectedIndex,
            'ruleId' => $selected !== null && isset($selected['id']) ? (int) $selected['id'] : null,
            'priority' => $selected !== null && isset($selected['priority']) ? (int) $selected['priority'] : null,
            'destination' => $chosen,
            'destinationWithUtm' => self::withUtmParameters($chosen, $utm),
        ];
    }

    /** @param array<int, string> $accepted */
    public static function languageMatches(string $ruleLanguage, array $accepted): bool
    {
        $rule = strtolower($ruleLanguage);
        foreach ($accepted as $language) {
            if ($language === $rule || (! str_contains($rule, '-') && str_starts_with($language, $rule.'-'))) {
                return true;
            }
        }

        return false;
    }

    public static function inTimeRange(?string $from, ?string $to, CarbonImmutable $now): bool
    {
        if (! $from && ! $to) {
            return true;
        }
        $minutes = ($now->hour * 60) + $now->minute;
        $toMin = static fn (?string $time): ?int => $time === null ? null : ((int) explode(':', $time)[0] * 60 + (int) (explode(':', $time)[1] ?? 0));
        $a = $toMin($from);
        $b = $toMin($to);
        if ($a !== null && $b !== null) {
            return $a <= $b ? ($minutes >= $a && $minutes <= $b) : ($minutes >= $a || $minutes <= $b);
        }
        if ($a !== null) {
            return $minutes >= $a;
        }

        return $minutes <= $b;
    }

    /** @param array<string, ?string> $configured */
    public static function withUtmParameters(string $destination, array $configured): string
    {
        $utm = [];
        foreach ($configured as $name => $value) {
            if ($value === null || $value === '') {
                continue;
            }
            // Link DTOs expose the friendly keys (`source`, `medium`, ...),
            // while persisted redirect state uses their wire names. Accept
            // both forms so the browser simulator and real redirect share one
            // deterministic implementation.
            $queryName = str_starts_with((string) $name, 'utm_') ? (string) $name : 'utm_'.(string) $name;
            if (in_array($queryName, ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'], true)) {
                $utm[$queryName] = (string) $value;
            }
        }
        if ($utm === []) {
            return $destination;
        }
        $fragment = '';
        $withoutFragment = $destination;
        $fragmentPosition = strpos($destination, '#');
        if ($fragmentPosition !== false) {
            $fragment = substr($destination, $fragmentPosition);
            $withoutFragment = substr($destination, 0, $fragmentPosition);
        }
        $base = $withoutFragment;
        $existingQuery = '';
        $queryPosition = strpos($withoutFragment, '?');
        if ($queryPosition !== false) {
            $base = substr($withoutFragment, 0, $queryPosition);
            $existingQuery = substr($withoutFragment, $queryPosition + 1);
        }
        $kept = [];
        foreach ($existingQuery === '' ? [] : explode('&', $existingQuery) as $segment) {
            $separator = strpos($segment, '=');
            $rawName = $separator === false ? $segment : substr($segment, 0, $separator);
            if (! array_key_exists(rawurldecode($rawName), $utm)) {
                $kept[] = $segment;
            }
        }
        foreach ($utm as $name => $value) {
            $kept[] = rawurlencode($name).'='.rawurlencode((string) $value);
        }

        return $base.'?'.implode('&', $kept).$fragment;
    }
}
