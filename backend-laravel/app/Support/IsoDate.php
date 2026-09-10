<?php

namespace App\Support;

use Illuminate\Support\Carbon;

/** Strict parser for dates crossing the public API boundary. */
final class IsoDate
{
    public static function parse(string $value): ?Carbon
    {
        if ($value === '' || strlen($value) > 64) {
            return null;
        }

        $normalized = $value;
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)) {
            $format = '!Y-m-d';
        } elseif (preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/D', $value)) {
            if (str_ends_with($normalized, 'Z')) {
                $normalized = substr($normalized, 0, -1).'+00:00';
            }
            $format = str_contains($normalized, '.') ? '!Y-m-d\TH:i:s.uP' : '!Y-m-d\TH:i:sP';
        } else {
            return null;
        }

        $parsed = \DateTimeImmutable::createFromFormat($format, $normalized);
        $errors = \DateTimeImmutable::getLastErrors();
        if (! $parsed || (is_array($errors) && ($errors['warning_count'] > 0 || $errors['error_count'] > 0))) {
            return null;
        }

        return Carbon::instance($parsed);
    }

    /**
     * Serialize an instant as UTC without mutating a caller-owned date object.
     * A literal Z is valid only after the offset has actually been normalized.
     */
    public static function format(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! $value instanceof \DateTimeInterface) {
            return (string) $value;
        }

        return \DateTimeImmutable::createFromInterface($value)
            ->setTimezone(new \DateTimeZone('UTC'))
            ->format('Y-m-d\TH:i:s.v\Z');
    }
}
