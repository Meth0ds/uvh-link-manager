<?php

namespace Tests\Feature;

use App\Models\CustomDomain;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Isolated diagnostic contract; it never invokes external DNS or TLS I/O. */
final class DomainDiagnosticsTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        config([
            'uvh.custom_domains.revalidation_hours' => 24,
            'uvh.custom_domains.failure_retry_hours' => 2,
            'uvh.custom_domains.cname_target' => 'edge.example.test',
        ]);
    }

    public function test_owner_receives_diagnostic_and_exact_failure_retry_schedule(): void
    {
        [$owner, $workspace] = $this->workspace();
        $completed = now()->subHours(3)->startOfSecond();
        $domain = $this->domain($workspace, [
            'dns_check_started_at' => $completed->copy()->subMinute(),
            'dns_check_completed_at' => $completed,
            'dns_error' => 'resolver_unavailable',
        ]);

        $this->signIn($owner, $workspace);
        $response = $this->getJson($this->path($workspace, $domain))->assertOk()
            ->assertJsonPath('domain.id', $domain->id)
            ->assertJsonPath('domain.verificationHost', '_uvh-verification.'.$domain->domain)
            ->assertJsonPath('domain.verificationToken', $domain->verification_token)
            ->assertJsonPath('domain.automaticDnsRetry', true)
            ->assertJsonPath('domain.dnsRetryIntervalHours', 2)
            ->assertJsonPath('domain.dnsCheckDue', true)
            ->assertJsonPath('domain.dnsCheckInProgress', false);

        $this->assertSame($completed->copy()->addHours(2)->format('Y-m-d\TH:i:s.v\Z'), $response->json('domain.nextDnsCheckAt'));
    }

    public function test_viewer_never_receives_the_ownership_challenge(): void
    {
        [$owner, $workspace] = $this->workspace();
        $viewer = User::factory()->create();
        $workspace->memberships()->create(['user_id' => $viewer->id, 'role' => 'viewer']);
        $domain = $this->domain($workspace);

        $this->signIn($viewer, $workspace);
        $response = $this->getJson($this->path($workspace, $domain))->assertOk()
            ->assertJsonPath('domain.verificationHost', null)
            ->assertJsonPath('domain.verificationToken', null)
            ->assertJsonPath('domain.cnameTarget', 'edge.example.test');
        $this->assertStringNotContainsString((string) $domain->verification_token, $response->getContent());
        $this->assertNotSame($owner->id, $viewer->id);
    }

    public function test_in_progress_check_has_no_competing_retry_date(): void
    {
        [$owner, $workspace] = $this->workspace();
        $domain = $this->domain($workspace, [
            'dns_check_started_at' => now()->subMinute(),
            'dns_check_completed_at' => now()->subHour(),
        ]);

        $this->signIn($owner, $workspace);
        $this->getJson($this->path($workspace, $domain))->assertOk()
            ->assertJsonPath('domain.dnsCheckInProgress', true)
            ->assertJsonPath('domain.nextDnsCheckAt', null)
            ->assertJsonPath('domain.dnsCheckDue', false);
    }

    public function test_foreign_workspace_domain_is_not_disclosed(): void
    {
        [$owner, $workspace] = $this->workspace();
        [, $foreign] = $this->workspace();
        $domain = $this->domain($foreign);

        $this->signIn($owner, $workspace);
        $response = $this->getJson($this->path($workspace, $domain))->assertNotFound();
        $response->assertExactJson(['error' => 'Dominio no encontrado']);
    }

    /** @return array{User, Workspace} */
    private function workspace(): array
    {
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Diagnostics', 'slug' => 'diag-'.Ids::randomToken(8)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);

        return [$owner, $workspace];
    }

    private function domain(Workspace $workspace, array $overrides = []): CustomDomain
    {
        return CustomDomain::create(array_merge([
            'workspace_id' => $workspace->id,
            'domain' => 'go-'.Ids::randomToken(6).'.example.test',
            'verification_token' => 'uvh-verify='.Ids::randomToken(24),
            'state' => 'active',
            'verified_at' => now()->subDay(),
            'ownership_verified_at' => now()->subDay(),
            'routing_verified_at' => now()->subDay(),
            'edge_eligible' => true,
            'tls_ready_at' => now()->subDay(),
        ], $overrides));
    }

    private function signIn(User $user, Workspace $workspace): void
    {
        $session = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true);
        $this->withCookie('uvh_session', $session);
        $this->withHeader('X-Workspace-Id', (string) $workspace->id);
    }

    private function path(Workspace $workspace, CustomDomain $domain): string
    {
        return '/api/v1/domains/'.$domain->id;
    }
}
