<?php

namespace App\Support;

/** Strict decimal input with caller-owned defaults and inclusive bounds. */
final class BoundedPositiveInteger
{
    public static function parse(mixed $value, int $default, int $max): int
    {
        if (is_string($value) && preg_match('/^[0-9]+$/D', $value) === 1) {
            $value = (int) $value;
        }
        if (! is_int($value) || $value < 1) {
            return $default;
        }

        return min($value, $max);
    }
}
