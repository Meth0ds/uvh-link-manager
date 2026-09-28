<?php

namespace Tests\Unit;

use App\Jobs\DnsStub;
use App\Jobs\DnsViews;
use PHPUnit\Framework\TestCase;

/**
 * El consenso DNS multi-resolver: el sistema contra los resolvedores públicos.
 *
 * La propiedad que se protege es que un único resolvedor envenenado no puede
 * «probar» un registro que nadie publicó. La regla es mayoría estricta de las
 * vistas que respondieron; una vista muda es silencio, no disenso, y un empate
 * no es respuesta. El resolvedor del sistema se sustituye por el stub de
 * nombres; los públicos, por el seam `fakePublicResolver`.
 */
class DnsViewsTest extends TestCase
{
    private const NAME = '_uvh-verification.shop.example.test';

    protected function setUp(): void
    {
        parent::setUp();
        require_once dirname(__DIR__).'/Support/dns-stub.php';
        DnsStub::reset();
        DnsViews::reset();
    }

    protected function tearDown(): void
    {
        // Estado estático: sin limpiar, contaminaría a las suites siguientes.
        DnsViews::reset();
        parent::tearDown();
    }

    public function test_without_public_resolvers_the_system_view_decides_alone(): void
    {
        DnsViews::usePublicResolvers([]);
        DnsStub::txt(self::NAME, 'uvh-verify=token');

        $records = DnsViews::records(self::NAME, DNS_TXT);

        $this->assertIsArray($records);
        $this->assertSame('uvh-verify=token', $records[0]['txt']);
    }

    public function test_a_majority_of_views_outvotes_a_poisoned_positive(): void
    {
        DnsViews::usePublicResolvers(['cloudflare', 'google']);
        // El resolvedor del sistema (envenenado) ve un TXT que nadie publicó;
        // los resolvedores públicos responden la verdad: ese nombre no existe.
        DnsStub::txt(self::NAME, 'uvh-verify=attacker');
        DnsViews::fakePublicResolver(static fn (): array => []);

        $this->assertSame([], DnsViews::records(self::NAME, DNS_TXT));
    }

    public function test_a_majority_ignores_a_dissenting_minority(): void
    {
        DnsViews::usePublicResolvers(['cloudflare', 'google']);
        DnsStub::txt(self::NAME, 'uvh-verify=real');
        DnsViews::fakePublicResolver(static fn (string $host, int $type, string $source): array => $source === 'google'
            ? [['txt' => 'uvh-verify=real']]
            : []);

        $records = DnsViews::records(self::NAME, DNS_TXT);

        $this->assertIsArray($records);
        $this->assertSame('uvh-verify=real', $records[0]['txt']);
    }

    public function test_a_tie_between_views_is_inconclusive_not_a_verdict(): void
    {
        DnsViews::usePublicResolvers(['google']);
        DnsStub::txt(self::NAME, 'uvh-verify=real');
        // Dos vistas que responden y discrepan: ninguna mayoría, ninguna
        // respuesta. Un empate jamás puede convertirse en «probado».
        DnsViews::fakePublicResolver(static fn (): array => []);

        $this->assertFalse(DnsViews::records(self::NAME, DNS_TXT));
    }

    public function test_a_failing_view_is_silence_not_dissent(): void
    {
        DnsViews::usePublicResolvers(['cloudflare', 'google']);
        DnsStub::txt(self::NAME, 'uvh-verify=real');
        DnsViews::fakePublicResolver(static fn (): array|false => false);

        $records = DnsViews::records(self::NAME, DNS_TXT);

        $this->assertIsArray($records);
        $this->assertSame('uvh-verify=real', $records[0]['txt']);
    }

    public function test_a_total_outage_has_no_answer(): void
    {
        DnsViews::usePublicResolvers(['cloudflare', 'google']);
        DnsStub::fail(self::NAME, DNS_TXT);
        DnsViews::fakePublicResolver(static fn (): array|false => false);

        $this->assertFalse(DnsViews::records(self::NAME, DNS_TXT));
    }

    public function test_ttl_order_and_case_do_not_break_agreement(): void
    {
        DnsViews::usePublicResolvers(['cloudflare', 'google']);
        DnsStub::answer(self::NAME, DNS_TXT, [
            ['txt' => 'AbC', 'ttl' => 60],
            ['txt' => 'DeF', 'ttl' => 60],
        ]);
        // Los resolvedores reordenan, renuevan TTL y normalizan la caja del
        // valor: eso no es una discrepancia de respuesta.
        DnsViews::fakePublicResolver(static fn (): array => [
            ['txt' => 'def', 'ttl' => 3600],
            ['txt' => 'abc', 'ttl' => 3600],
        ]);

        $records = DnsViews::records(self::NAME, DNS_TXT);

        $this->assertIsArray($records);
        $this->assertCount(2, $records);
        $this->assertSame('AbC', $records[0]['txt']);
    }

    public function test_record_shapes_without_a_type_still_compare_by_content(): void
    {
        DnsViews::usePublicResolvers(['google']);
        DnsStub::cname('go.example.test', 'edge.example.test');
        DnsViews::fakePublicResolver(static fn (): array => [['target' => 'EDGE.example.test.']]);

        $records = DnsViews::records('go.example.test', DNS_CNAME);

        $this->assertIsArray($records);
        $this->assertSame('edge.example.test', $records[0]['target']);
    }
}
