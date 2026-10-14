<?php

namespace App\Support;

/** Conservative, explainable diagnostics for ordered redirect rules. */
final class RuleConflictAnalyzer
{
    /**
     * @param  array<int, array<string, mixed>>  $rules
     * @return array{shadowedRules: list<int>, overlappingRules: list<int>, duplicateDestinations: list<list<int>>, impossibleRules: list<int>}
     */
    public static function analyze(array $rules): array
    {
        $shadowed = [];
        $overlapping = [];
        $impossible = [];
        $destinations = [];
        $ordered = [];
        foreach ($rules as $index => $rule) {
            if (self::isImpossible($rule)) {
                $impossible[] = $index;
            }
            $ordered[] = ['index' => $index, 'rule' => $rule, 'priority' => (int) ($rule['priority'] ?? 0), 'id' => isset($rule['id']) ? (int) $rule['id'] : null];
        }
        usort($ordered, static function (array $left, array $right): int {
            $priority = $left['priority'] <=> $right['priority'];
            if ($priority !== 0) {
                return $priority;
            }
            if ($left['id'] !== null && $right['id'] !== null && $left['id'] !== $right['id']) {
                return $left['id'] <=> $right['id'];
            }

            return $left['index'] <=> $right['index'];
        });
        foreach ($ordered as $position => $entry) {
            $index = $entry['index'];
            $rule = $entry['rule'];
            $destination = (string) ($rule['destination'] ?? '');
            if ($destination !== '') {
                $destinations[$destination][] = $index;
            }
            for ($previous = 0; $previous < $position; $previous++) {
                $previousRule = $ordered[$previous]['rule'];
                if (self::covers($previousRule, $rule)) {
                    $shadowed[] = $index;
                } elseif (self::overlaps($previousRule, $rule) && $destination !== (string) ($previousRule['destination'] ?? '')) {
                    $overlapping[] = $index;
                }
            }
        }
        $duplicate = array_values(array_filter(array_values($destinations), static fn (array $indexes): bool => count($indexes) > 1));

        return [
            'shadowedRules' => array_values(array_unique($shadowed)),
            'overlappingRules' => array_values(array_unique($overlapping)),
            'duplicateDestinations' => $duplicate,
            'impossibleRules' => array_values(array_unique($impossible)),
        ];
    }

    /**
     * Detect malformed conditions when the analyzer is used on an unsaved draft.
     *
     * @param  array<string, mixed>  $rule
     */
    private static function isImpossible(array $rule): bool
    {
        if (! is_string($rule['destination'] ?? null) || trim((string) $rule['destination']) === '') {
            return true;
        }
        if (isset($rule['priority']) && (! is_int($rule['priority']) || $rule['priority'] < 0 || $rule['priority'] > 1000)) {
            return true;
        }
        foreach (['time_from', 'time_to'] as $field) {
            $value = $rule[$field] ?? null;
            if ($value !== null && (! is_string($value) || preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/D', $value) !== 1)) {
                return true;
            }
        }
        if (($rule['country'] ?? null) !== null && (! is_string($rule['country']) || preg_match('/^[a-z]{2}$/iD', $rule['country']) !== 1)) {
            return true;
        }
        if (($rule['language'] ?? null) !== null && (! is_string($rule['language']) || preg_match('/^[a-z]{2,3}(?:-[a-z0-9]{2,4})?$/iD', $rule['language']) !== 1)) {
            return true;
        }
        if (($rule['device'] ?? null) !== null && ! in_array($rule['device'], ['desktop', 'mobile', 'tablet'], true)) {
            return true;
        }

        return false;
    }

    /**
     * A populated condition is narrower than an empty condition.
     *
     * @param  array<string, mixed>  $broad
     * @param  array<string, mixed>  $narrow
     */
    private static function covers(array $broad, array $narrow): bool
    {
        foreach (['country', 'language', 'device', 'os', 'referrer', 'campaign'] as $field) {
            $left = strtolower((string) ($broad[$field] ?? ''));
            $right = strtolower((string) ($narrow[$field] ?? ''));
            if ($left !== '' && $left !== $right) {
                if ($field === 'language' && ! str_contains($left, '-') && str_starts_with($right, $left.'-')) {
                    continue;
                }

                return false;
            }
        }

        $broadMinutes = self::minutes($broad['time_from'] ?? null, $broad['time_to'] ?? null);
        $narrowMinutes = self::minutes($narrow['time_from'] ?? null, $narrow['time_to'] ?? null);
        if (array_diff($narrowMinutes, $broadMinutes) !== []) {
            return false;
        }

        return true;
    }

    /**
     * @param  array<string, mixed>  $left
     * @param  array<string, mixed>  $right
     */
    private static function overlaps(array $left, array $right): bool
    {
        foreach (['country', 'device', 'language', 'os', 'referrer', 'campaign'] as $field) {
            $a = strtolower((string) ($left[$field] ?? ''));
            $b = strtolower((string) ($right[$field] ?? ''));
            if ($a !== '' && $b !== '' && $a !== $b && ! ($field === 'language' && (str_starts_with($a, $b.'-') || str_starts_with($b, $a.'-')))) {
                return false;
            }
        }

        return self::timeOverlaps($left['time_from'] ?? null, $left['time_to'] ?? null, $right['time_from'] ?? null, $right['time_to'] ?? null);
    }

    private static function timeOverlaps(?string $aFrom, ?string $aTo, ?string $bFrom, ?string $bTo): bool
    {
        $a = self::minutes($aFrom, $aTo);
        $b = self::minutes($bFrom, $bTo);
        foreach ($a as $minute) {
            if (in_array($minute, $b, true)) {
                return true;
            }
        }

        return false;
    }

    /** @return list<int> */
    private static function minutes(?string $from, ?string $to): array
    {
        $start = $from === null ? 0 : ((int) substr($from, 0, 2) * 60 + (int) substr($from, 3, 2));
        $end = $to === null ? 1439 : ((int) substr($to, 0, 2) * 60 + (int) substr($to, 3, 2));
        $result = [];
        for ($i = 0; $i < 1440; $i++) {
            $minute = ($start + $i) % 1440;
            if (($start <= $end && $minute > $end) || ($start > $end && $minute < $start && $minute > $end)) {
                break;
            }
            $result[] = $minute;
        }

        return $result;
    }
}
