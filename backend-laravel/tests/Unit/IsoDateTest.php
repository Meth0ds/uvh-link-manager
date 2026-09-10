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
}
