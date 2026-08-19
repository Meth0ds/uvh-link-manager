<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Support\Ids;
use App\Support\Ssrf;
use App\Support\UvhCrypto;
use App\Support\WebhookService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Guarda SSRF: cubre rangos IPv4, formas IPv6 de transición y rechazos de
 * assertSafeUrl, más la integración de entrega de webhook a destino privado.
 */
class SsrfTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, workspaces, memberships, quotas, webhooks, webhook_deliveries RESTART IDENTITY CASCADE');
    }

    public function test_ipv4_private_ranges_are_detected(): void
    {
        $private = [
            '0.0.0.0', '10.0.0.1', '100.64.0.1', '100.127.255.255',
            '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255',
            '192.0.0.1', '192.0.2.1', '192.168.1.1', '198.18.0.1',
            '203.0.113.5', '255.255.255.255',
        ];
        foreach ($private as $ip) {
            $this->assertTrue(Ssrf::isPrivateIp($ip), "{$ip} debería ser privada");
        }

        $public = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '198.20.0.1'];
        foreach ($public as $ip) {
            $this->assertFalse(Ssrf::isPrivateIp($ip), "{$ip} debería ser pública");
        }
    }

    public function test_ipv6_private_forms_are_detected(): void
    {
        $private = [
            '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1',
            '2001:db8::1',
            // IPv4-mapped / compatible
            '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::127.0.0.1', '::192.168.1.1',
            // NAT64 64:ff9b::/96 → 10.0.0.1
            '64:ff9b::a00:1',
            // 6to4 2002::/16 → 127.0.0.1
            '2002:7f00:1::',
            // Teredo 2001::/32 → complemento de 3fff:fdd2 = 192.0.2.45 (TEST-NET)
            '2001:0:4136:e378:8000:63bf:3fff:fdd2',
        ];
        foreach ($private as $ip) {
            $this->assertTrue(Ssrf::isPrivateIp($ip), "{$ip} debería ser privada");
        }

        $public = [
            '2606:4700:4700::1111', '2001:4860:4860::8888',
            '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::',
        ];
        foreach ($public as $ip) {
            $this->assertFalse(Ssrf::isPrivateIp($ip), "{$ip} debería ser pública");
        }
    }

    public function test_assert_safe_url_rejects_unsafe_targets(): void
    {
        $cases = [
            ['ftp://example.com/', 'esquema'],
            ['file:///etc/passwd', 'esquema'],
            ['gopher://example.com/', 'esquema'],
            ['https://user:pass@example.com/', 'credenciales'],
            ['http://example.com:21/', 'puerto'],
            ['http://example.com:22/', 'puerto'],
            ['http://127.0.0.1/', 'interno'],
            ['http://[::1]/', 'interno'],
            ['http://10.0.0.1:8080/', 'interno'],
            ['http://192.168.1.1:443/', 'interno'],
            ['http://169.254.169.254/latest/meta-data/', 'interno'],
            ['http://[::ffff:127.0.0.1]/', 'interno'],
            ['http://[64:ff9b::a00:1]/', 'interno'],
        ];

        foreach ($cases as [$url, $needle]) {
            try {
                Ssrf::assertSafeUrl($url);
                $this->fail("Debería rechazar {$url}");
            } catch (\RuntimeException $e) {
                $this->assertStringContainsString($needle, $e->getMessage(), "para {$url}");
            }
        }
    }

    public function test_assert_safe_url_accepts_public_host(): void
    {
        $records = @dns_get_record('example.com', DNS_A | DNS_AAAA);
        if ($records === false || $records === []) {
            $this->markTestSkipped('Sin resolución DNS en este entorno');
        }

        $info = Ssrf::assertSafeUrl('https://example.com/hook?x=1');
        $this->assertSame('example.com', $info['host']);
        $this->assertSame(443, $info['port']);
        $this->assertSame('/hook?x=1', $info['path']);
        $this->assertNotEmpty($info['ips']);
    }

    public function test_webhook_delivery_to_private_destination_is_blocked(): void
    {
        $user = User::create([
            'email' => 'ssrf@example.com',
            'name' => 'SSRF',
            'password_hash' => Hash::make('password-123456'),
        ]);
        $workspace = $user->ownedWorkspaces()->create(['name' => 'SSRF', 'slug' => 'ws-ssrf']);
        $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);

        $webhook = Webhook::create([
            'workspace_id' => $workspace->id,
            'url' => 'http://127.0.0.1:8080/private-hook',
            'secret' => UvhCrypto::encryptAtRest('ssrf-secret-123456'),
            'events' => ['link.created'],
            'active' => true,
        ]);

        WebhookService::dispatch($workspace->id, 'link.created', ['linkId' => 1, 'alias' => 'x']);

        $delivery = WebhookDelivery::where('webhook_id', $webhook->id)->firstOrFail();
        $this->assertSame('pending', $delivery->status);
        $this->assertGreaterThanOrEqual(1, (int) $delivery->attempts);
        $this->assertStringContainsString('SSRF', (string) $delivery->last_error);
        $this->assertNull($delivery->delivered_at);
    }
}
