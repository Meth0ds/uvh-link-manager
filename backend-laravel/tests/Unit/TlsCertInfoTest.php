<?php

namespace Tests\Unit;

use App\Support\TlsCertInfo;
use PHPUnit\Framework\TestCase;

/**
 * The certificate facts the platform keeps: expiry and issuer, parsed from the
 * plain strings cURL's CERTINFO hands over. Golden fixtures because a typo in
 * the date format would silently disable expiry monitoring.
 */
final class TlsCertInfoTest extends TestCase
{
    public function test_the_leaf_certificate_expiry_and_issuer_are_parsed(): void
    {
        $parsed = TlsCertInfo::fromCurlCertInfo([
            0 => [
                'Subject' => 'CN = shop.example.test',
                'Issuer' => 'C = US, O = Let\'s Encrypt, CN = R3',
                'Start date' => '2026-09-01 00:00:00',
                'Expire date' => '2026-11-30 00:00:00 GMT',
            ],
        ]);

        $this->assertNotNull($parsed);
        $this->assertSame('R3', $parsed['issuer']);
        $this->assertSame('2026-11-30', $parsed['notAfter']->format('Y-m-d'));
    }

    public function test_an_unparseable_or_absent_expiry_yields_no_fact(): void
    {
        $this->assertNull(TlsCertInfo::fromCertInfoEntry(['Expire date' => 'not-a-date']));
        $this->assertNull(TlsCertInfo::fromCertInfoEntry(['Subject' => 'CN = x']));
        $this->assertNull(TlsCertInfo::fromCurlCertInfo(null));
        $this->assertNull(TlsCertInfo::fromCurlCertInfo([]));
    }

    public function test_an_issuer_without_a_cn_falls_back_to_the_whole_line(): void
    {
        $this->assertSame('O = Some CA', TlsCertInfo::commonName('O = Some CA'));
        $this->assertNull(TlsCertInfo::commonName(null));
        $this->assertNull(TlsCertInfo::commonName(''));
    }

    public function test_the_first_parsable_entry_is_the_leaf(): void
    {
        $parsed = TlsCertInfo::fromCurlCertInfo([
            0 => ['Expire date' => 'garbage'],
            1 => [
                'Issuer' => 'CN = Root CA',
                'Expire date' => '2030-01-01 00:00:00 GMT',
            ],
        ]);

        $this->assertNotNull($parsed);
        $this->assertSame('Root CA', $parsed['issuer']);
    }
}
