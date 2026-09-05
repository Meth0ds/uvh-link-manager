<?php

namespace Tests\Unit;

use App\Http\Controllers\AnalyticsController;
use PHPUnit\Framework\TestCase;

class AnalyticsInputTest extends TestCase
{
    public function test_range_accepts_only_explicit_iso_dates_and_rfc3339_timestamps(): void
    {
        $this->assertTrue($this->range('2026-08-01', '2026-08-30')['ok']);
        $this->assertTrue($this->range('2026-08-01T10:20:30Z', '2026-08-30T12:00:00.123456+02:00')['ok']);

        foreach (['tomorrow', '2026-02-30', '2026-08-01 10:20:30', '2026-08-01T10:20:30'] as $invalid) {
            $this->assertFalse($this->range($invalid, '2026-08-30')['ok'], $invalid);
        }
    }

    public function test_link_id_parser_rejects_ambiguous_or_overflowing_values(): void
    {
        $this->assertSame(['ok' => true, 'value' => null], $this->linkId(null));
        $this->assertSame(['ok' => true, 'value' => 42], $this->linkId('42'));

        foreach (['', '0', '-1', '1.0', '12x', '01', '9999999999999999999', ['1']] as $invalid) {
            $this->assertFalse($this->linkId($invalid)['ok']);
        }
    }

    /** @return array<string, mixed> */
    private function range(?string $from, ?string $to): array
    {
        return $this->invoke('parseRange', ['7d', $from, $to]);
    }

    /** @return array<string, mixed> */
    private function linkId(mixed $value): array
    {
        return $this->invoke('parseLinkId', [$value]);
    }

    /** @param list<mixed> $arguments */
    private function invoke(string $method, array $arguments): array
    {
        $reflection = new \ReflectionMethod(AnalyticsController::class, $method);

        return $reflection->invoke(new AnalyticsController, ...$arguments);
    }
}
