<?php

namespace Tests\Unit;

use App\Support\BoundedPositiveInteger;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class BoundedPositiveIntegerTest extends TestCase
{
    /** @return list<array{mixed, ?int}> */
    public static function inputs(): array
    {
        return [
            [null, null], ['', null], [[], null], [['1'], null], [true, null], [false, null],
            [0, null], [-1, null], [1.0, null], [NAN, null], [INF, null],
            ['0', null], ['000', null], ['-1', null], ['+1', null], ['1.0', null], ['1e2', null],
            [' 1 ', null], ["1\n", null], ["1\0", null], ['١', null],
            [1, 1], ['1', 1], ['0001', 1], [99, 99], ['101', 101],
            [PHP_INT_MAX, PHP_INT_MAX], [str_repeat('9', 80), PHP_INT_MAX],
        ];
    }

    #[DataProvider('inputs')]
    public function test_strict_inputs_preserve_each_callers_fallback_and_ceiling(mixed $input, ?int $value): void
    {
        foreach ([[1, 10_000], [25, 100], [50, 100]] as [$default, $max]) {
            $this->assertSame($value === null ? $default : min($value, $max), BoundedPositiveInteger::parse($input, $default, $max));
        }
    }
}
