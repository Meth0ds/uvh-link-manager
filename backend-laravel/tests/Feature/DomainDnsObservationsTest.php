<?php

namespace Tests\Feature;

use App\Jobs\DnsStub;
use App\Jobs\VerifyDomainDnsJob;
use App\Models\CustomDomain;
use App\Models\User;
use App\Support\Ids;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * What UVH saw, not only what it concluded: the resolver's answer is stored
 * beside the verdict so a user fixing a broken CNAME is told what the resolver
 * returned instead, and a TLS failure can be blamed on a CAA record with its
 * exact contents. Prepared regression contracts: run only with the isolated
 * *_test DB guard.
 */
final class DomainDnsObservationsTest extends TestCase
{
    private const TOKEN = 'uvh-verify=Obs12345678';

    protected function setUp(): void
    {
        parent::setUp(); // Refuses non-*_test databases before fixture writes.
        DB::statement('TRUNCATE users, workspaces, custom_domains, custom_domain_claims, audit_events, operational_metrics, domain_events RESTART IDENTITY CASCADE');
        require_once dirname(__DIR__).'/Support/dns-stub.php';
        DnsStub::reset();
        config(['uvh.custom_domains.cname_target' => 'edge.example.test']);
        Queue::fake();
    }

    public function test_a_wrong_cname_records_the_target_the_resolver_returned(): void
    {
        $domain = $this->domain();
        DnsStub::answer('shop.example.test', DNS_CNAME, [['target' => 'cname.bitly.com.', 'ttl' => 300]]);
        DnsStub::txt('_uvh-verification.shop.example.test', self::TOKEN);

        $this->job($domain)->handle();

        $fresh = $domain->refresh();
        $this->assertSame('cname.bitly.com', $fresh->routing_observed_target);
        $this->assertSame(300, (int) $fresh->routing_observed_ttl);
        $this->assertFalse((bool) $fresh->routing_observed_proxied);
        $this->assertNotNull($fresh->dns_observed_at);
        $this->assertSame('routing_missing', $fresh->dns_error);
    }

    public function test_a_proxied_hostname_is_reported_as_such(): void
    {
        $domain = $this->domain();
        DnsStub::answer('shop.example.test', DNS_CNAME, [['target' => 'shop.example.test.cdn.cloudflare.net.', 'ttl' => 60]]);
        DnsStub::txt('_uvh-verification.shop.example.test', self::TOKEN);

        $this->job($domain)->handle();

        $fresh = $domain->refresh();
        $this->assertTrue((bool) $fresh->routing_observed_proxied);
    }

    public function test_an_address_only_answer_is_reported_as_a_proxy_or_flattening_setup(): void
    {
        // No CNAME at all, but the name answers with addresses: a proxied or
        // flattened setup — exactly what the product says it does not support.
        $domain = $this->domain();
        DnsStub::answer('shop.example.test', DNS_A, [['ip' => '104.16.1.2']]);
        DnsStub::answer('shop.example.test', DNS_AAAA, [['ipv6' => '2606:4700::1']]);
        DnsStub::txt('_uvh-verification.shop.example.test', self::TOKEN);

        $this->job($domain)->handle();

        $fresh = $domain->refresh();
        $this->assertNull($fresh->routing_observed_target);
        $this->assertTrue((bool) $fresh->routing_observed_proxied);
        $this->assertContains('104.16.1.2', (array) $fresh->routing_observed_addresses);
        $this->assertContains('2606:4700::1', (array) $fresh->routing_observed_addresses);
    }

    public function test_the_txt_presence_tells_a_missing_record_from_a_wrong_value(): void
    {
        $missing = $this->domain();
        DnsStub::txt('_uvh-verification.shop.example.test', 'some-other-value');
        $this->job($missing)->handle();
        $this->assertTrue((bool) $missing->refresh()->ownership_txt_present);

        DnsStub::reset();
        $absent = $this->domain();
        $this->job($absent)->handle();
        $this->assertFalse((bool) $absent->refresh()->ownership_txt_present);
    }

    public function test_caa_records_are_stored_and_judged_against_the_acme_issuer(): void
    {
        config(['uvh.custom_domains.acme_issuer' => 'letsencrypt.org']);
        $domain = $this->domain();
        DnsStub::txt('_uvh-verification.shop.example.test', self::TOKEN);
        DnsStub::cname('shop.example.test', 'edge.example.test');
        DnsStub::answer('shop.example.test', DNS_CAA, [
            ['tag' => 'issue', 'value' => 'digicert.com'],
            ['tag' => 'issuewild', 'value' => ';'],
        ]);

        $this->job($domain)->handle();

        $fresh = $domain->refresh();
        $this->assertFalse((bool) $fresh->caa_allows_issuer);
        $records = (array) $fresh->caa_records;
        $this->assertSame('issue', $records[0]['tag']);
        $this->assertSame('digicert.com', $records[0]['value']);
    }

    public function test_a_caa_record_for_the_issuer_is_an_explicit_allowance(): void
    {
        config(['uvh.custom_domains.acme_issuer' => 'letsencrypt.org']);
        $domain = $this->domain();
        DnsStub::txt('_uvh-verification.shop.example.test', self::TOKEN);
        DnsStub::cname('shop.example.test', 'edge.example.test');
        DnsStub::answer('shop.example.test', DNS_CAA, [
            ['tag' => 'issue', 'value' => 'letsencrypt.org; accounturi=https://acme.example/acct/1'],
        ]);

        $this->job($domain)->handle();

        $this->assertTrue((bool) $domain->refresh()->caa_allows_issuer);
    }

    public function test_no_caa_record_is_no_restriction_not_a_denial(): void
    {
        $domain = $this->domain();
        DnsStub::txt('_uvh-verification.shop.example.test', self::TOKEN);
        DnsStub::cname('shop.example.test', 'edge.example.test');

        $this->job($domain)->handle();

        $fresh = $domain->refresh();
        $this->assertNull($fresh->caa_allows_issuer);
        $this->assertNull($fresh->caa_records);
    }

    private function domain(): CustomDomain
    {
        $user = User::factory()->create();
        $workspace = $user->ownedWorkspaces()->create([
            'name' => 'Observations', 'slug' => 'observations-'.Ids::randomToken(8),
        ]);
        $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);

        return CustomDomain::create([
            'workspace_id' => $workspace->id,
            'domain' => 'shop.example.test',
            'verification_token' => self::TOKEN,
            'verification_version' => 1,
            'verification_scheme' => 2,
            'desired_state' => 'enabled',
            'ownership_status' => 'pending',
            'routing_status' => 'unknown',
            'tls_status' => 'pending',
        ]);
    }

    private function job(CustomDomain $domain): VerifyDomainDnsJob
    {
        return new VerifyDomainDnsJob(
            domainId: (int) $domain->id,
            workspaceId: (int) $domain->workspace_id,
            requestedBy: null,
            actorSecurityVersion: null,
            apiTokenId: null,
            domain: 'shop.example.test',
            verificationToken: self::TOKEN,
            verificationScheme: 2,
            verificationVersion: 1,
            dedupeKey: 'uvh:domain-verification:'.((int) $domain->workspace_id).':'.((int) $domain->id),
            dedupeOwner: 'observations-test',
        );
    }
}
