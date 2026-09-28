<?php

namespace Tests\Feature;

use App\Jobs\DnsStub;
use App\Jobs\ProvisionDomainTlsJob;
use App\Jobs\VerifyDomainDnsJob;
use App\Models\CustomDomain;
use App\Models\User;
use App\Support\DomainStatus;
use App\Support\Ids;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * Auto-TLS: when a check proves ownership and routing, certificate
 * provisioning starts in the same breath — no second «Preparar HTTPS» click.
 * The scheduler completes a setup or a recovery unattended (the user asked for
 * the domain to work; the platform finishes the job), bounded by the TLS
 * cooldown, and a domain its owner disabled is never revived. Prepared
 * regression contracts: run only with the isolated *_test DB guard.
 */
final class AutoTlsProvisioningTest extends TestCase
{
    private const TOKEN = 'uvh-verify=AutoTls12345678';

    protected function setUp(): void
    {
        parent::setUp(); // Refuses non-*_test databases before fixture writes.
        DB::statement('TRUNCATE users, workspaces, custom_domains, custom_domain_claims, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        require_once dirname(__DIR__).'/Support/dns-stub.php';
        DnsStub::reset();
        config(['uvh.custom_domains.cname_target' => 'edge.example.test']);
        Queue::fake();
    }

    public function test_a_user_requested_check_proving_both_records_starts_tls_provisioning(): void
    {
        [$user, $domain] = $this->fixture();
        $this->answerBoth();

        $this->job($user, $domain)->handle();

        $fresh = $domain->refresh();
        $this->assertSame('provisioning', $fresh->tls_status);
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
        [$user, $domain] = $this->fixture([
            'verified_at' => now(), 'tls_status' => 'error',
            'tls_error' => 'certificate_provisioning_failed',
        ]);
        $this->answerBoth();

        $this->job($user, $domain)->handle();

        $fresh = $domain->refresh();
        $this->assertSame('provisioning', $fresh->tls_status);
        $this->assertNull($fresh->tls_error);
        $this->assertSame(1, (int) $fresh->tls_version);
        Queue::assertPushed(ProvisionDomainTlsJob::class, 1);
    }

    public function test_a_failed_certificate_outside_its_cooldown_window_is_not_retried_by_the_sweep(): void
    {
        [, $domain] = $this->fixture([
            'verified_at' => now(), 'tls_status' => 'error',
            'tls_error' => 'certificate_provisioning_failed',
            'tls_next_retry_at' => now()->addHour(),
        ]);
        $this->answerBoth();

        $this->job(null, $domain)->handle();

        $fresh = $domain->refresh();
        $this->assertSame('error', $fresh->tls_status);
        $this->assertSame(0, (int) $fresh->tls_version);
        Queue::assertNothingPushed();
    }

    public function test_the_scheduler_finishes_a_setup_or_recovery_without_a_click(): void
    {
        // Unattended recovery: the domain served before, DNS broke, and the
        // sweep's check now proves everything again. The platform finishes.
        [, $domain] = $this->fixture(['verified_at' => now()->subDay()]);
        $this->answerBoth();

        $this->job(null, $domain)->handle();

        $fresh = $domain->refresh();
        $this->assertSame('provisioning', $fresh->tls_status);
        $this->assertTrue((bool) $fresh->edge_eligible);
        $this->assertSame(1, (int) $fresh->tls_version);
        Queue::assertPushed(ProvisionDomainTlsJob::class, fn (ProvisionDomainTlsJob $job) => $job->requestedBy === null);
    }

    public function test_a_domain_the_owner_disabled_is_never_revived_with_tls(): void
    {
        [$user, $domain] = $this->fixture(['desired_state' => 'disabled']);
        $this->answerBoth();

        $this->job($user, $domain)->handle();

        $fresh = $domain->refresh();
        $this->assertSame('disabled', $fresh->desired_state);
        $this->assertNotSame('provisioning', $fresh->tls_status);
        $this->assertSame(0, (int) $fresh->tls_version);
        // Only the certificate is withheld; the outbox still fans out the
        // domain's history.
        Queue::assertNotPushed(ProvisionDomainTlsJob::class);
    }

    public function test_a_check_without_both_records_still_provisions_nothing(): void
    {
        [$user, $domain] = $this->fixture();
        // Ownership only: routing is missing, so nothing is proven.
        DnsStub::txt('_uvh-verification.shop.example.test', self::TOKEN);

        $this->job($user, $domain)->handle();

        $fresh = $domain->refresh();
        $this->assertSame('error', DomainStatus::legacyState($fresh));
        $this->assertSame('routing_missing', $fresh->dns_error);
        $this->assertSame('failed', $fresh->routing_status);
        Queue::assertNotPushed(ProvisionDomainTlsJob::class);
    }

    /** @return array{User, CustomDomain} */
    private function fixture(array $extra = []): array
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
            'verification_version' => 1,
            'verification_scheme' => 2,
            'desired_state' => 'enabled',
            'ownership_status' => 'pending',
            'routing_status' => 'unknown',
            'tls_status' => 'pending',
        ], $extra));

        return [$user, $domain];
    }

    private function job(?User $requestedBy, CustomDomain $domain): VerifyDomainDnsJob
    {
        return new VerifyDomainDnsJob(
            domainId: (int) $domain->id,
            workspaceId: (int) $domain->workspace_id,
            requestedBy: $requestedBy === null ? null : (int) $requestedBy->id,
            actorSecurityVersion: $requestedBy === null ? null : (int) $requestedBy->security_version,
            apiTokenId: null,
            domain: 'shop.example.test',
            verificationToken: self::TOKEN,
            verificationScheme: 2,
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
