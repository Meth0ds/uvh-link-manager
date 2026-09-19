<?php

namespace Tests\Unit;

use App\Support\IsoDate;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class IsoDateTest extends TestCase
{
    #[DataProvider('offsetProvider')]
    public function test_format_converts_offsets_to_the_same_utc_instant(string $input, string $expected): void
    {
        $date = new \DateTimeImmutable($input);

        $this->assertSame($expected, IsoDate::format($date));
        // Formatting is a boundary operation and must not mutate a mutable or
        // immutable object owned by its caller.
        $this->assertSame($input, $date->format('Y-m-d\TH:i:sP'));
    }

    public static function offsetProvider(): array
    {
        return [
            'UTC' => ['2026-03-29T10:00:00+00:00', '2026-03-29T10:00:00.000Z'],
            'positive offset' => ['2026-03-29T12:00:00+02:00', '2026-03-29T10:00:00.000Z'],
            'negative offset' => ['2026-03-29T05:30:00-04:30', '2026-03-29T10:00:00.000Z'],
        ];
    }

    /**
     * The same instant arrives in two shapes and leaves in one.
     *
     * A model casts a `timestamptz` to a date object; the query builder hands
     * back the string PostgreSQL rendered. Endpoints that mixed both answered
     * the same field in two formats, and the string one is not ISO: the panel's
     * decoders require `YYYY-MM-DDTHH:MM:SS`.
     *
     * @return list<array{string, string}>
     */
    public static function storageShapeProvider(): array
    {
        return [
            ['2026-09-16 12:00:00+00', '2026-09-16T12:00:00.000Z'],
            ['2026-09-16 12:00:00.123456+00', '2026-09-16T12:00:00.123Z'],
            ['2026-09-16 14:00:00+02', '2026-09-16T12:00:00.000Z'],
            ['2026-09-16 14:00:00.5+02:00', '2026-09-16T12:00:00.500Z'],
            ['2026-09-16 12:00:00', '2026-09-16T12:00:00.000Z'],
            ['2026-09-16T12:00:00Z', '2026-09-16T12:00:00.000Z'],
            ['2026-09-16', '2026-09-16T00:00:00.000Z'],
        ];
    }

    #[DataProvider('storageShapeProvider')]
    public function test_a_timestamp_read_from_storage_is_served_as_iso(string $input, string $expected): void
    {
        $this->assertSame($expected, IsoDate::format($input));
    }

    public function test_a_value_that_is_not_an_instant_is_not_serialised_as_one(): void
    {
        // An integer, a boolean and a word used to be echoed as strings.
        $this->assertNull(IsoDate::format(123));
        $this->assertNull(IsoDate::format(true));
        $this->assertNull(IsoDate::format('no soy una fecha'));
        $this->assertNull(IsoDate::format([]));
        $this->assertNull(IsoDate::format(''));
        // ...and a date that does not exist is not rolled over into one that does.
        $this->assertNull(IsoDate::format('2026-02-30 10:00:00+00'));
        $this->assertNull(IsoDate::format('2026-13-01 10:00:00+00'));

        $this->assertNull(IsoDate::format(null));
    }
}
