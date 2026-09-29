<?php

namespace Tests\Feature;

use App\Console\Commands\UvhHousekeeping;
use App\Jobs\ProbeDomainTlsJob;
use App\Models\CustomDomain;
use App\Models\User;
use App\Support\Ids;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use ReflectionMethod;
use Tests\TestCase;

/**
 * Certificate lifetime monitoring: the probe records what the certificate
 * says about itself and withdraws a domain only on sustained handshake
 * failure — a platform outage must never take customer domains down. The
 * probe results are injected through `apply()` so the contracts run without a
 * network; the handshake itself lives in `EdgeTlsProbe` and is proven by the
 * production E2E. Prepared regression contracts: run only with the isolated
 * *_test DB guard.
 */
final class DomainTlsProbeTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp(); // Refuses non-*_test databases before fixture writes.
        DB::statement('TRUNCATE users, workspaces, custom_domains, custom_domain_claims, audit_events, operational_metrics, domain_events RESTART IDENTITY CASCADE');
        config(['uvh.custom_domains.max_failures' => 3, 'uvh.custom_domains.tls_expiry_warn_days' => 20]);
        Queue::fake();
    }

    public function test_a_healthy_certificate_keeps_serving_and_records_its_facts(): void
    {
        $domain = $this->domain(['tls_probe_failures' => 2]);
        $notAfter = now()->addDays(60);

        $this->apply($domain, ['status' => 204, 'cert' => ['notAfter' => $notAfter, 'issuer' => 'R3']]);

        $fresh = $domain->refresh();
        $this->assertSame('ready', $fresh->tls_status);
        $this->assertTrue((bool) $fresh->edge_eligible);
        $this->assertSame(0, (int) $fresh->tls_probe_failures);
        $this->assertSame('R3', $fresh->tls_issuer);
        $this->assertNotNull($fresh->tls_not_after);
        $this->assertNotNull($fresh->tls_checked_at);
        $this->assertNull($fresh->tls_error);
    }

    public function test_a_certificate_inside_the_warn_window_is_flagged_expiring_once(): void
    {
        $domain = $this->domain();

        $this->apply($domain, ['status' => 204, 'cert' => ['notAfter' => now()->addDays(10), 'issuer' => 'R3']]);

        $fresh = $domain->refresh();
        $this->assertSame('expiring', $fresh->tls_status);
        $this->assertTrue((bool) $fresh->edge_eligible);
        $this->assertDatabaseHas('domain_events', [
            'domain_id' => (int) $domain->id, 'event' => 'domain.tls_expiring',
        ]);

        // Already flagged: the second probe updates the facts, not the inbox.
        $this->apply($fresh, ['status' => 204, 'cert' => ['notAfter' => now()->addDays(9), 'issuer' => 'R3']]);
        $this->assertSame(1, DB::table('domain_events')->where('event', 'domain.tls_expiring')->count());
    }

    public function test_a_renewed_certificate_returns_to_ready(): void
    {
        $domain = $this->domain(['tls_status' => 'expiring']);

        $this->apply($domain, ['status' => 204, 'cert' => ['notAfter' => now()->addDays(80), 'issuer' => 'R3']]);

        $this->assertSame('ready', $domain->refresh()->tls_status);
    }

    public function test_a_transient_handshake_failure_keeps_the_domain_serving(): void
    {
        $domain = $this->domain();

        $this->apply($domain, ['status' => 0, 'cert' => null]);

        $fresh = $domain->refresh();
        $this->assertSame('ready', $fresh->tls_status);
        $this->assertTrue((bool) $fresh->edge_eligible);
        $this->assertSame(1, (int) $fresh->tls_probe_failures);
        $this->assertSame('certificate_check_failed', $fresh->tls_error);
    }

    public function test_sustained_handshake_failure_withdraws_the_domain(): void
    {
        $domain = $this->domain(['tls_probe_failures' => 2]);

        $this->apply($domain, ['status' => 0, 'cert' => null]);

        $fresh = $domain->refresh();
        $this->assertSame('error', $fresh->tls_status);
        $this->assertFalse((bool) $fresh->edge_eligible);
        $this->assertNull($fresh->tls_ready_at);
        $this->assertSame('certificate_probe_failed', $fresh->tls_error);
        $this->assertDatabaseHas('domain_events', [
            'domain_id' => (int) $domain->id, 'event' => 'domain.tls_failed',
        ]);
    }

    public function test_an_expired_certificate_withdraws_the_domain_immediately(): void
    {
        $domain = $this->domain();

        $this->apply($domain, ['status' => 204, 'cert' => ['notAfter' => now()->subDay(), 'issuer' => 'R3']]);

        $fresh = $domain->refresh();
        $this->assertSame('error', $fresh->tls_status);
        $this->assertFalse((bool) $fresh->edge_eligible);
        $this->assertSame('certificate_expired', $fresh->tls_error);
        $this->assertDatabaseHas('domain_events', [
            'domain_id' => (int) $domain->id, 'event' => 'domain.tls_failed',
        ]);
    }

    public function test_a_platform_http_error_is_never_evidence_against_the_certificate(): void
    {
        // Health answering 500 means *the platform* is unhappy, not the
        // certificate. Withdrawing customer domains on top of an outage would
        // compound it.
        $domain = $this->domain(['tls_probe_failures' => 1]);

        $this->apply($domain, ['status' => 500, 'cert' => ['notAfter' => now()->addDays(60), 'issuer' => 'R3']]);

        $fresh = $domain->refresh();
        $this->assertSame('ready', $fresh->tls_status);
        $this->assertTrue((bool) $fresh->edge_eligible);
        $this->assertSame(0, (int) $fresh->tls_probe_failures);
    }

    public function test_the_housekeeping_sweep_rotates_through_serving_domains(): void
    {
        $stale = $this->domain(['tls_checked_at' => now()->subDays(3)]);
        $fresh = $this->domain(['tls_checked_at' => now()]);
        $untouched = $this->domain(['desired_state' => 'disabled', 'edge_eligible' => false]);

        (new ReflectionMethod(UvhHousekeeping::class, 'queueTlsProbeChecks'))->invoke(new UvhHousekeeping);

        Queue::assertPushed(ProbeDomainTlsJob::class, 1);
        Queue::assertPushed(ProbeDomainTlsJob::class, fn (ProbeDomainTlsJob $job) => $job->domainId === (int) $stale->id);
        Queue::assertNotPushed(ProbeDomainTlsJob::class, fn (ProbeDomainTlsJob $job) => $job->domainId === (int) $fresh->id);
        Queue::assertNotPushed(ProbeDomainTlsJob::class, fn (ProbeDomainTlsJob $job) => $job->domainId === (int) $untouched->id);
    }

    public function test_repeated_housekeeping_passes_enqueue_one_probe_per_round(): void
    {
        $domain = $this->domain(['tls_checked_at' => now()->subDays(3)]);

        // Three passes with no worker draining the queue: one round, one job.
        $sweep = new ReflectionMethod(UvhHousekeeping::class, 'queueTlsProbeChecks');
        $sweep->invoke(new UvhHousekeeping);
        $sweep->invoke(new UvhHousekeeping);
        $sweep->invoke(new UvhHousekeeping);

        Queue::assertPushed(ProbeDomainTlsJob::class, 1);
        $fresh = $domain->refresh();
        $this->assertSame(1, (int) $fresh->tls_probe_version);
        $this->assertNotNull($fresh->tls_probe_started_at);
        $this->assertNull($fresh->tls_probe_completed_at);
    }

    public function test_duplicate_jobs_of_one_round_only_count_one_failure(): void
    {
        $domain = $this->domain(['tls_probe_failures' => 0]);
        $this->apply($domain, ['status' => 0, 'cert' => null]);
        $claimed = $domain->refresh();
        $version = (int) $claimed->tls_probe_version;
        $this->assertSame(1, (int) $claimed->tls_probe_failures);

        // Two more copies of the same queued round arrive late.
        foreach ([0, 1] as $_) {
            (new ReflectionMethod(ProbeDomainTlsJob::class, 'apply'))->invoke(
                new ProbeDomainTlsJob((int) $domain->id, (int) $domain->workspace_id, $domain->domain, $version),
                ['status' => 0, 'cert' => null],
            );
        }

        $fresh = $domain->refresh();
        $this->assertSame(1, (int) $fresh->tls_probe_failures);
        $this->assertSame('ready', $fresh->tls_status);
        $this->assertTrue((bool) $fresh->edge_eligible);
    }

    public function test_a_job_from_a_superseded_round_writes_nothing(): void
    {
        $domain = $this->domain();
        $this->apply($domain, ['status' => 204, 'cert' => ['notAfter' => now()->addDays(60), 'issuer' => 'R3']]);
        $observedAt = (string) $domain->refresh()->tls_checked_at;

        // Housekeeping reclaimed the row (expired lease): a newer round exists.
        DB::table('custom_domains')->where('id', $domain->id)->update([
            'tls_probe_version' => DB::raw('tls_probe_version + 1'),
            'tls_probe_started_at' => now(),
            'tls_probe_completed_at' => null,
        ]);
        $version = (int) $domain->refresh()->tls_probe_version;

        (new ReflectionMethod(ProbeDomainTlsJob::class, 'apply'))->invoke(
            new ProbeDomainTlsJob((int) $domain->id, (int) $domain->workspace_id, $domain->domain, $version - 1),
            ['status' => 0, 'cert' => null],
        );

        $fresh = $domain->refresh();
        $this->assertSame(0, (int) $fresh->tls_probe_failures);
        $this->assertSame($observedAt, (string) $fresh->tls_checked_at);
    }

    public function test_an_expired_probe_lease_is_reclaimed_by_a_later_pass(): void
    {
        $domain = $this->domain([
            'tls_checked_at' => now()->subDays(3),
            'tls_probe_started_at' => now()->subHours(2),
            'tls_probe_completed_at' => null,
        ]);

        (new ReflectionMethod(UvhHousekeeping::class, 'queueTlsProbeChecks'))->invoke(new UvhHousekeeping);

        Queue::assertPushed(ProbeDomainTlsJob::class, 1);
        $fresh = $domain->refresh();
        $this->assertSame(1, (int) $fresh->tls_probe_version);
    }

    /**
     * One probe result applied to the domain. `$newRound` claims a fresh
     * monitoring round first (what the housekeeping sweep does before
     * dispatching); passing `false` replays a job of the *current* round, the
     * way a duplicated queue entry would.
     *
     * @param  array{status: int, cert: array{notAfter: CarbonInterface|null, issuer: ?string}|null}  $probe
     */
    private function apply(CustomDomain $domain, array $probe, bool $newRound = true): void
    {
        if ($newRound) {
            DB::table('custom_domains')->where('id', $domain->id)->update([
                'tls_probe_version' => DB::raw('tls_probe_version + 1'),
                'tls_probe_started_at' => now(),
                'tls_probe_completed_at' => null,
            ]);
            $domain->refresh();
        }
        (new ReflectionMethod(ProbeDomainTlsJob::class, 'apply'))->invoke(
            new ProbeDomainTlsJob(
                (int) $domain->id,
                (int) $domain->workspace_id,
                $domain->domain,
                (int) $domain->tls_probe_version,
            ),
            $probe,
        );
    }

    private function domain(array $extra = []): CustomDomain
    {
        $user = User::factory()->create();
        $workspace = $user->ownedWorkspaces()->create([
            'name' => 'TLS probe', 'slug' => 'tls-probe-'.Ids::randomToken(8),
        ]);
        $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);

        return CustomDomain::create(array_merge([
            'workspace_id' => $workspace->id,
            'domain' => 'shop-'.Ids::randomToken(6).'.example.test',
            'verification_token' => 'uvh-verify=TlsProbe1234',
            'verification_version' => 1,
            'verification_scheme' => 2,
            'desired_state' => 'enabled',
            'ownership_status' => 'verified',
            'routing_status' => 'healthy',
            'tls_status' => 'ready',
            'verified_at' => Carbon::now()->subDay(),
            'ownership_verified_at' => Carbon::now()->subDay(),
            'routing_verified_at' => Carbon::now()->subDay(),
            'edge_eligible' => true,
            'tls_ready_at' => Carbon::now()->subDay(),
            'tls_not_after' => Carbon::now()->addDays(60),
            'tls_issuer' => 'R3',
        ], $extra));
    }
}
