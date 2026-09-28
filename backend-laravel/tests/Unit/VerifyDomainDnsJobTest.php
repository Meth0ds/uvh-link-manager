<?php

namespace Tests\Unit;

use App\Jobs\DnsStub;
use App\Jobs\DnsViews;
use App\Jobs\VerifyDomainDnsJob;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

/**
 * Ownership verification against the TXT record an operator retypes by hand.
 *
 * The verification token is a base64url string, so it contains upper case; the
 * DNS record is created by a person copying that string into a control panel,
 * and the value that comes back out of the resolver is the provider's version
 * of it. Comparing the two byte by byte makes verification depend on a detail
 * the operator cannot see: a panel that normalises case, or a token retyped in
 * the wrong case, produces the generic `ownership_missing` answer and the
 * domain never activates.
 *
 * The comparison therefore has to be case-insensitive, which is what the CNAME
 * check in the same job already does with the same kind of provider data.
 *
 * The resolver is replaced by a namespaced stub, so this runs in process and
 * asserts the decision rather than the DNS.
 */
class VerifyDomainDnsJobTest extends TestCase
{
    private const TOKEN = 'uvh-verify=AbC123xYz-_90AbCd';

    protected function setUp(): void
    {
        parent::setUp();
        require_once dirname(__DIR__).'/Support/dns-stub.php';
        DnsStub::reset();
        DnsViews::reset();
    }

    protected function tearDown(): void
    {
        // Estado estático: sin limpiar, el consenso de un test decidiría el
        // siguiente y las suites con app propia heredarían las vistas falsas.
        DnsViews::reset();
        parent::tearDown();
    }

    private function job(string $domain = 'shop.example.test', string $token = self::TOKEN, int $scheme = 1): VerifyDomainDnsJob
    {
        return new VerifyDomainDnsJob(
            domainId: 1,
            workspaceId: 1,
            requestedBy: 1,
            actorSecurityVersion: 1,
            apiTokenId: null,
            domain: $domain,
            verificationToken: $token,
            verificationScheme: $scheme,
            verificationVersion: 1,
            dedupeKey: 'dedupe',
            dedupeOwner: 'owner',
        );
    }

    private function ownership(VerifyDomainDnsJob $job): bool
    {
        $result = (new ReflectionMethod($job, 'checkTxt'))->invoke($job);

        return (bool) $result['matched'];
    }

    public function test_the_token_is_found_at_the_dedicated_label(): void
    {
        DnsStub::txt('_uvh-verification.shop.example.test', self::TOKEN);

        $this->assertTrue($this->ownership($this->job()));
    }

    public function test_a_poisoned_system_resolver_cannot_prove_ownership(): void
    {
        DnsViews::usePublicResolvers(['cloudflare', 'google']);
        // El resolvedor del sistema «ve» el TXT que nadie publicó: el mundo
        // real no tiene ese registro y su respuesta vacía lo desautoriza.
        DnsStub::txt('_uvh-verification.shop.example.test', self::TOKEN);
        DnsViews::fakePublicResolver(static fn (): array => []);

        $this->assertFalse($this->ownership($this->job()));
    }

    public function test_ownership_needs_a_majority_not_every_view(): void
    {
        DnsViews::usePublicResolvers(['cloudflare', 'google']);
        DnsStub::txt('_uvh-verification.shop.example.test', self::TOKEN);
        DnsViews::fakePublicResolver(static fn (string $host, int $type, string $source): array => $source === 'google'
            ? [['txt' => self::TOKEN]]
            : []);

        $this->assertTrue($this->ownership($this->job()));
    }

    public function test_the_token_is_found_when_the_provider_normalises_its_case(): void
    {
        // What a panel that upper-cases (or lower-cases) the value hands back.
        DnsStub::txt('_uvh-verification.shop.example.test', strtoupper(self::TOKEN));
        $this->assertTrue($this->ownership($this->job()));

        DnsStub::reset();
        DnsStub::txt('_uvh-verification.shop.example.test', strtolower(self::TOKEN));
        $this->assertTrue($this->ownership($this->job()));
    }

    public function test_a_different_token_is_never_accepted(): void
    {
        DnsStub::txt('_uvh-verification.shop.example.test', 'uvh-verify=AbC123xYz-_90ZZZZZ');
        $this->assertFalse($this->ownership($this->job()));

        DnsStub::reset();
        // A prefix is not a match either: the whole value has to be the token.
        DnsStub::txt('_uvh-verification.shop.example.test', 'uvh-verify=AbC123xYz-_90AbCd oops');
        $this->assertFalse($this->ownership($this->job()));
    }

    public function test_a_long_value_split_into_chunks_is_joined_before_comparing(): void
    {
        DnsStub::txt('_uvh-verification.shop.example.test', ['uvh-verify=', 'AbC123xYz-', '_90AbCd']);

        $this->assertTrue($this->ownership($this->job()));
    }

    public function test_trimming_never_eats_a_letter_of_the_token_itself(): void
    {
        // A token ending in `t`, `r` or `n` — all ordinary base64url letters —
        // must survive the whitespace/quote trimming of the TXT value.
        $token = 'uvh-verify=AbC123xYz-_90AbCn';
        DnsStub::txt('_uvh-verification.shop.example.test', '"'.$token.'"');

        $this->assertTrue($this->ownership($this->job(token: $token)));
    }

    public function test_the_bare_hostname_remains_a_fallback_for_older_domains(): void
    {
        DnsStub::txt('shop.example.test', self::TOKEN);

        $this->assertTrue($this->ownership($this->job()));
        $this->assertSame(
            ['_uvh-verification.shop.example.test|'.DNS_TXT, 'shop.example.test|'.DNS_TXT],
            DnsStub::queries(),
        );
    }

    public function test_a_retired_fallback_is_never_consulted_for_scheme_two_domains(): void
    {
        // The bare-hostname fallback was temporary. New integrations carry
        // scheme 2 and only the dedicated label counts for them.
        DnsStub::txt('shop.example.test', self::TOKEN);

        $this->assertFalse($this->ownership($this->job(scheme: 2)));
        $this->assertSame(['_uvh-verification.shop.example.test|'.DNS_TXT], DnsStub::queries());
    }

    public function test_a_missing_record_is_absent_ownership_not_a_resolver_failure(): void
    {
        $this->assertFalse($this->ownership($this->job()));
    }

    public function test_a_resolver_failure_is_never_read_as_lost_ownership(): void
    {
        DnsStub::fail('_uvh-verification.shop.example.test', DNS_TXT);
        DnsStub::fail('shop.example.test', DNS_TXT);

        $this->expectException(\RuntimeException::class);
        $this->ownership($this->job());
    }
}
