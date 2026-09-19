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
     *
     * Three shapes reach this method and all three leave as the same one:
     *
     *  - a date object, from a model or from `now()`;
     *  - an ISO string, which is what a client sent;
     *  - the storage form of a `timestamptz` read through the query builder
     *    (`2026-09-16 12:00:00+00`), which is *not* ISO and used to be echoed
     *    verbatim: two endpoints answered the same field in two different
     *    formats, and the one that arrived was a shape half the clients in the
     *    panel refuse to parse.
     *
     * Anything else — an integer, a boolean, an array, a word — is not a
     * timestamp and returns `null`. Serializing it as a string was a typed lie
     * an API consumer could only discover by rendering it.
     */
    public static function format(mixed $value): ?string
    {
        $instant = self::instant($value);
        if ($instant === null) {
            return null;
        }

        return $instant->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z');
    }

    /** The instant a value denotes, or null when it does not denote one. */
    private static function instant(mixed $value): ?\DateTimeImmutable
    {
        if ($value === null) {
            return null;
        }
        if ($value instanceof \DateTimeInterface) {
            return \DateTimeImmutable::createFromInterface($value);
        }
        if (! is_string($value) || $value === '') {
            return null;
        }

        $iso = self::parse($value);
        if ($iso !== null) {
            return \DateTimeImmutable::createFromInterface($iso);
        }

        return self::fromStorage($value);
    }

    /**
     * The `timestamptz` shape as PostgreSQL renders it when a row is read
     * through the query builder rather than through a cast-bearing model.
     *
     * A naive value is read as UTC: every instant this application writes comes
     * from `now()` under `app.timezone = UTC`, and the connection does the same.
     */
    private static function fromStorage(string $value): ?\DateTimeImmutable
    {
        $pattern = '/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:([+-]\d{2})(?::?(\d{2}))?|Z)?$/D';
        if (preg_match($pattern, $value, $match) !== 1) {
            return null;
        }

        $fraction = ($match[3] ?? '') === '' ? '000000' : str_pad($match[3], 6, '0');
        $offset = ($match[4] ?? '') === '' ? '+00:00' : $match[4].':'.($match[5] ?? '00');
        $normalized = $match[1].' '.$match[2].'.'.$fraction.$offset;

        $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d H:i:s.uP', $normalized);
        // The round-trip catches what `createFromFormat` silently rolls over
        // instead of rejecting, such as the 31st of February.
        if ($parsed === false || $parsed->format('Y-m-d H:i:s.uP') !== $normalized) {
            return null;
        }

        return $parsed;
    }
}
