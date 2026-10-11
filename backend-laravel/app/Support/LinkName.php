<?php

namespace App\Support;

/** Workspace metadata; never part of the public redirect surface. */
final class LinkName
{
    public static function valid(mixed $value): bool
    {
        return $value === null || (is_string($value) && mb_check_encoding($value, 'UTF-8')
            && ! preg_match('/[\p{Cc}\p{Cf}]/u', $value)
            && mb_strlen(self::normalize($value) ?? '') <= 120);
    }

    public static function normalize(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }
        $name = preg_replace('/^\s+|\s+$/u', '', $value);

        return $name === '' ? null : $name;
    }
}
