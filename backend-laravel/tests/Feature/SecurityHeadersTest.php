<?php

namespace Tests\Feature;

use Tests\TestCase;

class SecurityHeadersTest extends TestCase
{
    public function test_dynamic_responses_are_not_cacheable_and_use_modern_browser_isolation(): void
    {
        $response = $this->getJson('/api/v1/config');

        $response->assertOk();
        $response->assertJsonPath('hcaptcha.enabled', true);
        $response->assertJsonPath('hcaptcha.siteKey', '10000000-ffff-ffff-ffff-000000000001');
        $this->assertStringNotContainsString('0x0000000000000000000000000000000000000000', $response->getContent());
        $cacheControl = (string) $response->headers->get('Cache-Control');
        $this->assertStringContainsString('no-store', $cacheControl);
        $this->assertStringContainsString('private', $cacheControl);
        $this->assertStringContainsString('max-age=0', $cacheControl);
        $response->assertHeader('Pragma', 'no-cache');
        $response->assertHeader('Referrer-Policy', 'no-referrer');
        $response->assertHeader('Cross-Origin-Opener-Policy', 'same-origin');
        $response->assertHeader('Cross-Origin-Resource-Policy', 'same-origin');
        $response->assertHeader('Origin-Agent-Cluster', '?1');
        $response->assertHeader('X-Permitted-Cross-Domain-Policies', 'none');

        $csp = (string) $response->headers->get('Content-Security-Policy');
        $this->assertStringContainsString("object-src 'none'", $csp);
        $this->assertStringContainsString("frame-ancestors 'none'", $csp);
        $this->assertStringContainsString("require-trusted-types-for 'script'", $csp);
        $this->assertStringNotContainsString('fonts.googleapis.com', $csp);
    }

    public function test_hsts_is_only_emitted_for_secure_requests_when_enabled(): void
    {
        config(['uvh.hsts_enabled' => true]);

        $this->get('/health')->assertHeaderMissing('Strict-Transport-Security');
        // Never bless an arbitrary Host header with HSTS; emit it only for a
        // configured first-party origin over an authenticated HTTPS request.
        $this->get('https://attacker.invalid/health')->assertHeaderMissing('Strict-Transport-Security');
        $this->get('https://app.uvh.test/health')
            ->assertHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
}
