<?php

namespace Tests\Unit;

use App\Support\Totp;
use PHPUnit\Framework\TestCase;

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
}
