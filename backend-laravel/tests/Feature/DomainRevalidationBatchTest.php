<?php

namespace Tests\Feature;

use App\Console\Commands\UvhHousekeeping;
use App\Jobs\VerifyDomainDnsJob;
use App\Models\CustomDomain;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use ReflectionMethod;
use Tests\TestCase;

final class DomainRevalidationBatchTest extends TestCase
{
    public function test_housekeeping_queues_a_due_domain_with_its_workspace_in_one_batch_read(): void
    {
        Queue::fake();
        Cache::forget('uvh:housekeeping:last_heavy');
        config([
            'uvh.custom_domains.revalidation_hours' => 24,
            'uvh.custom_domains.failure_retry_hours' => 2,
            'uvh.custom_domains.revalidation_batch' => 10,
        ]);

        $workspace = $this->workspace('Revalidation');
        $domain = $this->dueDomain($workspace->id);

        $this->artisan('uvh:housekeeping')->assertExitCode(0);

        Queue::assertPushed(
            VerifyDomainDnsJob::class,
            fn (VerifyDomainDnsJob $job): bool => $job->domainId === $domain->id
                && $job->workspaceId === $workspace->id,
        );
    }

    public function test_housekeeping_reads_workspace_ids_with_the_batch_instead_of_per_domain(): void
    {
        Queue::fake();
        Cache::flush();
        config([
            'uvh.custom_domains.revalidation_hours' => 24,
            'uvh.custom_domains.failure_retry_hours' => 2,
            'uvh.custom_domains.revalidation_batch' => 10,
        ]);

        $firstWorkspace = $this->workspace('Batch A');
        $secondWorkspace = $this->workspace('Batch B');
        $firstDomain = $this->dueDomain($firstWorkspace->id);
        $secondDomain = $this->dueDomain($secondWorkspace->id);

        $queries = [];
        DB::listen(function ($query) use (&$queries): void {
            $queries[] = $query->sql;
        });

        $command = app(UvhHousekeeping::class);
        $method = new ReflectionMethod($command, 'queueDomainRevalidations');
        $method->setAccessible(true);
        $method->invoke($command);

        $customDomainSelects = array_values(array_filter(
            $queries,
            static function (string $sql): bool {
                $normalised = str_replace(['"', '`'], '', strtolower($sql));

                return str_starts_with(ltrim($normalised), 'select')
                    && str_contains($normalised, 'from custom_domains');
            },
        ));

        // One batch read plus one locked re-read per domain. The previous
        // implementation added one workspace_id lookup per domain.
        $this->assertCount(3, $customDomainSelects);

        Queue::assertPushed(
            VerifyDomainDnsJob::class,
            fn (VerifyDomainDnsJob $job): bool => $job->domainId === $firstDomain->id
                && $job->workspaceId === $firstWorkspace->id,
        );
        Queue::assertPushed(
            VerifyDomainDnsJob::class,
            fn (VerifyDomainDnsJob $job): bool => $job->domainId === $secondDomain->id
                && $job->workspaceId === $secondWorkspace->id,
        );
    }

    private function workspace(string $name): Workspace
    {
        $user = User::factory()->create();
        $workspace = $user->ownedWorkspaces()->create([
            'name' => $name,
            'slug' => 'ws-'.Ids::randomToken(8),
        ]);
        $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);

        return $workspace;
    }

    private function dueDomain(int $workspaceId): CustomDomain
    {
        return CustomDomain::create([
            'workspace_id' => $workspaceId,
            'domain' => 'reval-'.Ids::randomToken(6).'.example.test',
            'verification_token' => 'uvh-verify='.Ids::randomToken(24),
            'desired_state' => 'enabled',
            'ownership_status' => 'verified',
            'routing_status' => 'healthy',
            'tls_status' => 'ready',
            'verified_at' => now()->subDay(),
            'ownership_verified_at' => now()->subDay(),
            'routing_verified_at' => now()->subDay(),
            'edge_eligible' => true,
            'tls_ready_at' => now()->subDay(),
        ]);
    }
}
