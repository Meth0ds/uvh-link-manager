<?php

namespace Tests\Feature;

use App\Jobs\ProvisionDomainTlsJob;
use App\Models\CustomDomain;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Idempotency;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * The optional `Idempotency-Key` on the domain mutations. A retried
 * create/activate/disable must receive the original response instead of
 * re-executing: a second create collides with the uniqueness guard, a second
 * activation can spend another issuance. Errors release the key so the same
 * intent stays retryable. Prepared regression contracts: run only with the
 * isolated *_test DB guard.
 */
final class DomainIdempotencyTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp(); // Refuses non-*_test databases before fixture writes.
        DB::statement('TRUNCATE users, workspaces, memberships, quotas, custom_domains, custom_domain_claims, domain_events, links, audit_events, idempotency_keys RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'idem-csrf')->withHeaders(['X-CSRF-Token' => 'idem-csrf']);
    }

    public function test_a_retried_create_receives_the_original_response(): void
    {
        [$owner, $workspace] = $this->actor();
        $this->signIn($owner, $workspace);
        $this->withHeader('Idempotency-Key', 'create-abc12345');

        $first = $this->postJson('/api/v1/domains', ['domain' => 'go.example.test']);
        $first->assertCreated();
        $this->assertNotNull($first->json('domain.verificationToken'));

        $retry = $this->postJson('/api/v1/domains', ['domain' => 'go.example.test']);
        $retry->assertCreated()->assertHeader('Idempotent-Replay', 'true');
        $this->assertSame($first->json(), $retry->json());
        $this->assertSame(1, DB::table('custom_domains')->count());
    }

    public function test_a_reused_key_with_a_different_body_is_rejected(): void
    {
        [$owner, $workspace] = $this->actor();
        $this->signIn($owner, $workspace);
        $this->withHeader('Idempotency-Key', 'create-other01');

        $this->postJson('/api/v1/domains', ['domain' => 'go.example.test'])->assertCreated();
        $this->postJson('/api/v1/domains', ['domain' => 'other.example.test'])
            ->assertStatus(409)
            ->assertJsonPath('error', 'Esta Idempotency-Key ya se usó con otra petición');
        $this->assertSame(1, DB::table('custom_domains')->count());
    }

    public function test_an_invalid_key_never_executes(): void
    {
        [$owner, $workspace] = $this->actor();
        $this->signIn($owner, $workspace);
        $this->withHeader('Idempotency-Key', 'short');

        $this->postJson('/api/v1/domains', ['domain' => 'go.example.test'])->assertStatus(422);
        $this->assertSame(0, DB::table('custom_domains')->count());
        $this->assertSame(0, DB::table('idempotency_keys')->count());
    }

    public function test_a_key_in_flight_blocks_a_concurrent_retry(): void
    {
        [$owner, $workspace] = $this->actor();
        $this->signIn($owner, $workspace);
        // Reserve the key exactly as a request still running would hold it.
        Idempotency::begin(
            (int) $owner->id,
            'domains.create:'.$workspace->id.':challenge',
            'create-inflight1',
            Idempotency::hash((string) json_encode(['domain' => 'go.example.test'])),
        );

        $this->withHeader('Idempotency-Key', 'create-inflight1')
            ->postJson('/api/v1/domains', ['domain' => 'go.example.test'])
            ->assertStatus(409)
            ->assertJsonPath('error', 'Ya hay una operación en curso con esta clave. Espera a que termine.');
        $this->assertSame(0, DB::table('custom_domains')->count());
    }

    public function test_a_retried_activation_replays_without_a_second_issuance(): void
    {
        Queue::fake();
        [$owner, $workspace] = $this->actor();
        $domain = $this->readyDomain($workspace);
        $this->signIn($owner, $workspace);
        $this->withHeader('Idempotency-Key', 'activate-once01');

        $first = $this->postJson('/api/v1/domains/'.$domain->id.'/activate');
        $first->assertStatus(202)->assertJson(['ok' => true, 'state' => 'provisioning']);

        $retry = $this->postJson('/api/v1/domains/'.$domain->id.'/activate');
        $retry->assertStatus(202)->assertHeader('Idempotent-Replay', 'true');
        $this->assertSame($first->json(), $retry->json());
        Queue::assertPushed(ProvisionDomainTlsJob::class, 1);
    }

    public function test_a_retried_disable_replays_the_original_response(): void
    {
        [$owner, $workspace] = $this->actor();
        $domain = $this->readyDomain($workspace);
        $this->signIn($owner, $workspace);
        $this->withHeader('Idempotency-Key', 'disable-once-01');

        $first = $this->postJson('/api/v1/domains/'.$domain->id.'/disable');
        $first->assertOk()->assertJson(['ok' => true, 'state' => 'disabled']);

        $retry = $this->postJson('/api/v1/domains/'.$domain->id.'/disable');
        $retry->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertSame($first->json(), $retry->json());
    }

    public function test_a_failed_attempt_releases_the_key_for_a_later_retry(): void
    {
        [$owner, $workspace] = $this->actor();
        $domain = $this->readyDomain($workspace);
        $this->signIn($owner, $workspace);
        $this->withHeader('Idempotency-Key', 'disable-retry-01');

        // A failed intent seals nothing: the very same key must be able to
        // carry the corrected request to completion.
        $this->postJson('/api/v1/domains/999999/disable')->assertStatus(404);
        $this->assertSame(0, DB::table('idempotency_keys')->count());

        $this->postJson('/api/v1/domains/'.$domain->id.'/disable')->assertOk();
        $this->assertDatabaseHas('custom_domains', ['id' => $domain->id, 'desired_state' => 'disabled']);
    }

    /** @return array{User, Workspace} */
    private function actor(): array
    {
        /** @var User $owner */
        $owner = User::factory()->create(['email_verified_at' => now()]);
        /** @var Workspace $workspace */
        $workspace = $owner->ownedWorkspaces()->create([
            'name' => 'Idempotency', 'slug' => 'idem-'.Ids::randomToken(8),
        ]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);

        return [$owner, $workspace];
    }

    private function signIn(User $user, Workspace $workspace): void
    {
        $session = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true);
        $this->withCookie('uvh_session', $session);
        $this->withHeader('X-Workspace-Id', (string) $workspace->id);
    }

    /**
     * Ownership and routing proven, no certificate yet: activating it goes
     * straight to provisioning. Edge-ineligible keeps the schema CHECK happy.
     */
    private function readyDomain(Workspace $workspace): CustomDomain
    {
        return CustomDomain::create([
            'workspace_id' => $workspace->id,
            'domain' => 'go.example.test',
            'verification_token' => 'uvh-verify=Idem123456',
            'verification_version' => 1,
            'verification_scheme' => 2,
            'desired_state' => 'enabled',
            'ownership_status' => 'verified',
            'routing_status' => 'healthy',
            'tls_status' => 'pending',
            'verified_at' => now(),
            'ownership_verified_at' => now(),
            'routing_verified_at' => now(),
            'edge_eligible' => false,
        ]);
    }
}
