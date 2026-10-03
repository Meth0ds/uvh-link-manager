<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\MfaFreshness;
use DateTimeImmutable;
use Illuminate\Support\Carbon;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class MfaFreshnessTest extends TestCase
{
    #[DataProvider('boundaryProvider')]
    public function test_freshness_expires_at_the_deadline_with_microsecond_precision(int $offset, bool $fresh): void
    {
        Carbon::setTestNow(Carbon::parse('2026-10-02T12:00:00.000000Z'));
        try {
            config(['uvh.admin_mfa_fresh_minutes' => 15]);
            $verified = now()->subMinutes(15)->addMicroseconds($offset);
            $original = $verified->format('c.u');
            self::assertSame($fresh, MfaFreshness::isFresh($verified));
            self::assertSame($original, $verified->format('c.u'));
        } finally {
            Carbon::setTestNow();
        }
    }

    public static function boundaryProvider(): array
    {
        return [
            'before expiry' => [1, true],
            'at expiry' => [0, false],
            'after expiry' => [-1, false],
        ];
    }

    public function test_never_verified_and_equivalent_timezone_deadlines_are_not_fresh(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-10-02T12:00:00Z'));
        try {
            config(['uvh.admin_mfa_fresh_minutes' => 15]);
            self::assertFalse(MfaFreshness::isFresh(null));
            self::assertFalse(MfaFreshness::isFresh(new DateTimeImmutable('2026-10-02T13:45:00+02:00')));
            self::assertTrue(MfaFreshness::isFresh(new DateTimeImmutable('2026-10-02T13:45:00.000001+02:00')));
        } finally {
            Carbon::setTestNow();
        }
    }
}
