<?php

namespace Tests\Feature;

use App\Jobs\DnsStub;
use App\Jobs\ProvisionDomainTlsJob;
use App\Jobs\VerifyDomainDnsJob;
use App\Models\CustomDomain;
use App\Models\User;
use App\Support\Ids;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * Auto-TLS (F6): when a person asks for the ownership+routing check and it
 * proves both records, certificate provisioning starts in the same breath — no
 * second «Preparar HTTPS» click. The periodic sweep never starts ACME on its
 * own and a domain its owner disabled stays put. Prepared regression
 * contracts: run only with the isolated *_test DB guard.
 */
final class AutoTlsProvisioningTest extends TestCase
{
    private const TOKEN = 'uvh-verify=AutoTls12345678';

    protected function setUp(): void
    {
        parent::setUp(); // Refuses non-*_test databases before fixture writes.
        DB::statement('TRUNCATE users, workspaces, custom_domains, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        require_once dirname(__DIR__).'/Support/dns-stub.php';
        DnsStub::reset();
        config(['uvh.custom_domains.cname_target' => 'edge.example.test']);
        Queue::fake();
    }

    public function test_a_user_requested_check_proving_both_records_starts_tls_provisioning(): void
    {
        [$user, $domain] = $this->fixture('verifying');
        $this->answerBoth();

        $this->job($user, $domain, 'verifying')->handle();

        $fresh = $domain->refresh();
        $this->assertSame('provisioning', $fresh->state);
        $this->assertTrue((bool) $fresh->edge_eligible);
        $this->assertSame(1, (int) $fresh->tls_version);
        $this->assertNotNull($fresh->ownership_verified_at);
        $this->assertNotNull($fresh->routing_verified_at);
        Queue::assertPushed(ProvisionDomainTlsJob::class, fn (ProvisionDomainTlsJob $job) => $job->domainId === (int) $domain->id
            && $job->tlsVersion === 1 && $job->requestedBy === (int) $user->id);
        $this->assertDatabaseHas('audit_events', [
            'user_id' => $user->id, 'action' => 'domain.tls_requested',
        ]);
    }

    public function test_a_revalidation_that_proves_both_records_retries_a_failed_certificate(): void
    {
        [$user, $domain] = $this->fixture('verified', [
            'verified_at' => now(), 'tls_error' => 'certificate_provisioning_failed',
        ]);
        $this->answerBoth();

        $this->job($user, $domain, 'verified')->handle();

        $fresh = $domain->refresh();
        $this->assertSame('provisioning', $fresh->state);
        $this->assertNull($fresh->tls_error);
        $this->assertSame(1, (int) $fresh->tls_version);
        Queue::assertPushed(ProvisionDomainTlsJob::class, 1);
    }

    public function test_the_periodic_sweep_never_starts_acme_on_its_own(): void
    {
        [, $domain] = $this->fixture('verifying');
        $this->answerBoth();

        $this->job(null, $domain, 'verifying')->handle();

        $fresh = $domain->refresh();
        $this->assertSame('verified', $fresh->state);
        $this->assertFalse((bool) $fresh->edge_eligible);
        $this->assertSame(0, (int) $fresh->tls_version);
        Queue::assertNothingPushed();
    }

    public function test_a_domain_the_owner_disabled_is_never_revived_with_tls(): void
    {
        [$user, $domain] = $this->fixture('disabled');
        $this->answerBoth();

        $this->job($user, $domain, 'disabled')->handle();

        $fresh = $domain->refresh();
        $this->assertNotSame('provisioning', $fresh->state);
        $this->assertSame(0, (int) $fresh->tls_version);
        Queue::assertNothingPushed();
    }

    public function test_a_check_without_both_records_still_provisions_nothing(): void
    {
        [$user, $domain] = $this->fixture('verifying');
        // Ownership only: routing is missing, so nothing is proven.
        DnsStub::txt('_uvh-verification.shop.example.test', self::TOKEN);

        $this->job($user, $domain, 'verifying')->handle();

        $fresh = $domain->refresh();
        $this->assertSame('error', $fresh->state);
        $this->assertSame('routing_missing', $fresh->dns_error);
        Queue::assertNothingPushed();
    }

    /** @return array{User, CustomDomain} */
    private function fixture(string $state, array $extra = []): array
    {
        $user = User::factory()->create();
        $workspace = $user->ownedWorkspaces()->create([
            'name' => 'Auto TLS', 'slug' => 'auto-tls-'.Ids::randomToken(8),
        ]);
        $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
        $domain = CustomDomain::create(array_merge([
            'workspace_id' => $workspace->id,
            'domain' => 'shop.example.test',
            'verification_token' => self::TOKEN,
            'state' => $state,
            'verification_version' => 1,
        ], $extra));

        return [$user, $domain];
    }

    private function job(?User $requestedBy, CustomDomain $domain, string $previousState): VerifyDomainDnsJob
    {
        return new VerifyDomainDnsJob(
            domainId: (int) $domain->id,
            workspaceId: (int) $domain->workspace_id,
            requestedBy: $requestedBy === null ? null : (int) $requestedBy->id,
            domain: 'shop.example.test',
            verificationToken: self::TOKEN,
            previousState: $previousState,
            verificationVersion: 1,
            dedupeKey: 'uvh:domain-verification:'.((int) $domain->workspace_id).':'.((int) $domain->id),
            dedupeOwner: 'auto-tls-test',
        );
    }

    private function answerBoth(): void
    {
        DnsStub::txt('_uvh-verification.shop.example.test', self::TOKEN);
        DnsStub::cname('shop.example.test', 'edge.example.test');
    }
}
