<?php

namespace Tests\Unit;

use App\Support\Totp;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

class TotpTest extends TestCase
{
    public function test_provisioning_label_is_encoded_as_one_path_segment(): void
    {
        $uri = Totp::provisioningUri('user/name@example.test', 'UVH', 'JBSWY3DPEHPK3PXP');

        $this->assertStringStartsWith('otpauth://totp/UVH%3Auser%2Fname%40example.test?', $uri);
        $this->assertStringContainsString('issuer=UVH', $uri);
    }

    public function test_malformed_secrets_and_codes_fail_closed(): void
    {
        $this->assertFalse(Totp::verify('12345', 'JBSWY3DPEHPK3PXP'));
        $this->assertFalse(Totp::verify('123456', 'INVALID!SECRET'));
    }

    /** RFC 4226 Appendix D, with its published 20-byte ASCII key. */
    #[DataProvider('hotpReferenceProvider')]
    public function test_hotp_matches_published_interoperability_vectors(int $counter, string $expected): void
    {
        $method = new ReflectionMethod(Totp::class, 'hotp');
        self::assertSame($expected, $method->invoke(null, '12345678901234567890', $counter));
    }

    public static function hotpReferenceProvider(): array
    {
        // https://www.rfc-editor.org/rfc/rfc4226.html#appendix-D
        return [
            [0, '755224'], [1, '287082'], [2, '359152'], [3, '969429'], [4, '338314'],
            [5, '254676'], [6, '287922'], [7, '162583'], [8, '399871'], [9, '520489'],
        ];
    }

    /** RFC 6238 Appendix B SHA1 vectors, reduced to the supported six digits. */
    #[DataProvider('totpReferenceProvider')]
    public function test_six_digit_sha1_matches_published_time_vectors(int $timestamp, string $expected): void
    {
        $method = new ReflectionMethod(Totp::class, 'hotp');
        self::assertSame($expected, $method->invoke(null, '12345678901234567890', intdiv($timestamp, 30)));
    }

    public static function totpReferenceProvider(): array
    {
        // https://www.rfc-editor.org/rfc/rfc6238.html#appendix-B
        return [
            [59, '287082'], [1111111109, '081804'], [1111111111, '050471'],
            [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130'],
        ];
    }

    public function test_reference_secret_decodes_to_the_exact_interoperable_key(): void
    {
        $encoded = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
        $method = new ReflectionMethod(Totp::class, 'base32Decode');
        self::assertTrue(Totp::isUsableSecret($encoded));
        self::assertSame('12345678901234567890', $method->invoke(null, $encoded));
        self::assertSame('12345678901234567890', $method->invoke(null, strtolower($encoded)));
    }
}
