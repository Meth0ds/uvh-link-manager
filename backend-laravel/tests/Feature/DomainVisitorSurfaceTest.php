<?php

namespace Tests\Feature;

use App\Models\CustomDomain;
use App\Models\Link;
use App\Models\User;
use App\Models\Workspace;
use App\Support\DomainClaims;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The visitor-facing surface of a custom domain: what `/` does and what an
 * unknown path gets, per the owner's configuration. The root is a brand's
 * landing; a stray visit must never be silently swallowed by the platform's
 * generic page when the owner chose otherwise. Prepared regression contracts:
 * run only with the isolated *_test DB guard.
 */
final class DomainVisitorSurfaceTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp(); // Refuses non-*_test databases before fixture writes.
        DB::statement('TRUNCATE users, workspaces, custom_domains, custom_domain_claims, links, audit_events RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'visitor-csrf')->withHeaders(['X-CSRF-Token' => 'visitor-csrf']);
    }

    public function test_the_root_redirects_to_the_configured_destination(): void
    {
        $domain = $this->domain(['root_destination' => 'https://brand.example.test/home']);
        $this->link($domain, 'somewhere');

        $response = $this->get('http://shop.example.test/');

        $this->assertSame(302, $response->getStatusCode());
        $this->assertSame('https://brand.example.test/home', $response->headers->get('Location'));
    }

    public function test_a_configured_root_does_not_change_link_resolution(): void
    {
        $domain = $this->domain(['root_destination' => 'https://brand.example.test/home']);
        $this->link($domain, 'promo', 'https://brand.example.test/promo');

        $response = $this->get('http://shop.example.test/promo');

        $this->assertSame(302, $response->getStatusCode());
        $this->assertSame('https://brand.example.test/promo', $response->headers->get('Location'));
    }

    public function test_unknown_paths_can_follow_the_root_destination(): void
    {
        $this->domain(['root_destination' => 'https://brand.example.test/home', 'not_found_mode' => 'redirect']);

        $response = $this->get('http://shop.example.test/does-not-exist');

        $this->assertSame(302, $response->getStatusCode());
        $this->assertSame('https://brand.example.test/home', $response->headers->get('Location'));
    }

    public function test_a_branded_not_found_answers_as_the_domain_not_the_platform(): void
    {
        $this->domain(['not_found_mode' => 'branded']);

        $response = $this->get('http://shop.example.test/does-not-exist');

        $this->assertSame(404, $response->getStatusCode());
        $content = (string) $response->getContent();
        $this->assertStringContainsString('shop.example.test', $content);
        $this->assertStringNotContainsString('· UVH', $content);
    }

    public function test_the_default_mode_keeps_the_platform_notice(): void
    {
        $this->domain();

        $response = $this->get('http://shop.example.test/does-not-exist');

        $this->assertSame(404, $response->getStatusCode());
        $this->assertStringContainsString('· UVH', (string) $response->getContent());
    }

    public function test_the_root_without_configuration_is_a_not_found(): void
    {
        $this->domain();

        $response = $this->get('http://shop.example.test/');

        $this->assertSame(404, $response->getStatusCode());
    }

    public function test_an_unserved_hostname_gets_the_domain_notice_everywhere(): void
    {
        $this->domain(['root_destination' => 'https://brand.example.test/home', 'not_found_mode' => 'redirect']);
        // Serving requires intent + edge + certificate; withdrawing cuts the
        // root redirect too.
        DB::table('custom_domains')->update(['edge_eligible' => false]);

        $this->assertSame(404, $this->get('http://shop.example.test/')->getStatusCode());
        $this->assertSame(404, $this->get('http://shop.example.test/anything')->getStatusCode());
    }

    public function test_the_settings_endpoint_writes_and_clears_the_visitor_surface(): void
    {
        [$owner, $workspace, $domain] = $this->servedDomain();
        $this->signIn($owner, $workspace);

        $set = $this->patchJson('/api/v1/domains/'.$domain->id, [
            'rootDestination' => 'https://brand.example.test/home',
            'notFoundMode' => 'redirect',
        ]);
        $set->assertStatus(200);
        $set->assertJsonPath('domain.rootDestination', 'https://brand.example.test/home');
        $set->assertJsonPath('domain.notFoundMode', 'redirect');

        // An explicit empty value clears; an absent key preserves.
        $this->patchJson('/api/v1/domains/'.$domain->id, ['rootDestination' => ''])
            ->assertStatus(200)
            ->assertJsonPath('domain.rootDestination', null);
        $this->assertNull($domain->refresh()->root_destination);
        $this->assertSame('redirect', $domain->not_found_mode);
    }

    public function test_the_default_domain_preference_moves_between_domains(): void
    {
        [$owner, $workspace, $domain] = $this->servedDomain();
        $second = CustomDomain::create([
            'workspace_id' => $workspace->id,
            'domain' => 'alt.example.test',
            'verification_token' => 'uvh-verify=Visitor654321',
            'verification_version' => 1,
            'verification_scheme' => 2,
            'desired_state' => 'enabled',
            'ownership_status' => 'verified',
            'routing_status' => 'healthy',
            'tls_status' => 'ready',
            'verified_at' => now(),
            'ownership_verified_at' => now(),
            'routing_verified_at' => now(),
            'edge_eligible' => true,
            'tls_ready_at' => now(),
        ]);
        $this->signIn($owner, $workspace);

        $this->patchJson('/api/v1/domains/'.$domain->id, ['isDefault' => true])
            ->assertStatus(200)
            ->assertJsonPath('domain.isDefault', true);
        // The preference is exclusive: taking it over releases the previous.
        $this->patchJson('/api/v1/domains/'.$second->id, ['isDefault' => true])
            ->assertStatus(200)
            ->assertJsonPath('domain.isDefault', true);
        $this->assertTrue((bool) $second->refresh()->is_default);
        $this->assertFalse((bool) $domain->refresh()->is_default);

        // An explicit false clears; an absent key preserves (PATCH contract).
        $this->patchJson('/api/v1/domains/'.$second->id, ['isDefault' => false])
            ->assertStatus(200)
            ->assertJsonPath('domain.isDefault', false);
        $this->assertFalse((bool) $second->refresh()->is_default);
    }

    public function test_a_domain_that_cannot_serve_cannot_be_the_default(): void
    {
        [$owner, $workspace] = $this->servedDomain();
        $idle = $this->domain([
            'workspace_id' => $workspace->id,
            'domain' => 'idle.example.test',
            'edge_eligible' => false,
            'tls_ready_at' => null,
            'tls_status' => 'pending',
        ]);
        $this->signIn($owner, $workspace);

        $this->patchJson('/api/v1/domains/'.$idle->id, ['isDefault' => true])->assertStatus(422);
        $this->assertFalse((bool) $idle->refresh()->is_default);
    }

    public function test_the_settings_endpoint_rejects_nonsense(): void
    {
        [$owner, $workspace, $domain] = $this->servedDomain();
        $this->signIn($owner, $workspace);

        $this->patchJson('/api/v1/domains/'.$domain->id, ['rootDestination' => 'javascript:alert(1)'])->assertStatus(422);
        $this->patchJson('/api/v1/domains/'.$domain->id, ['notFoundMode' => 'wat'])->assertStatus(422);
        // Redirecting unknown paths needs somewhere to send them.
        $this->patchJson('/api/v1/domains/'.$domain->id, ['notFoundMode' => 'redirect'])->assertStatus(422);
        $this->assertNull($domain->refresh()->not_found_mode);
    }

    private function signIn(User $user, Workspace $workspace): void
    {
        $session = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true);
        $this->withCookie('uvh_session', $session);
        $this->withHeader('X-Workspace-Id', (string) $workspace->id);
    }

    /** @return array{User, Workspace, CustomDomain} */
    private function servedDomain(): array
    {
        $domain = $this->domain();
        $workspace = Workspace::findOrFail($domain->workspace_id);
        $owner = User::findOrFail((int) $workspace->owner_user_id);

        return [$owner, $workspace, $domain];
    }

    private function domain(array $attributes = []): CustomDomain
    {
        /** @var User $owner */
        $owner = User::factory()->create(['email_verified_at' => now()]);
        /** @var Workspace $workspace */
        $workspace = $owner->ownedWorkspaces()->create([
            'name' => 'Visitor surface', 'slug' => 'visitor-'.Ids::randomToken(8),
        ]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);

        $domain = CustomDomain::create(array_merge([
            'workspace_id' => $workspace->id,
            'domain' => 'shop.example.test',
            'verification_token' => 'uvh-verify=Visitor1234',
            'verification_version' => 1,
            'verification_scheme' => 2,
            'desired_state' => 'enabled',
            'ownership_status' => 'verified',
            'routing_status' => 'healthy',
            'tls_status' => 'ready',
            'verified_at' => now(),
            'ownership_verified_at' => now(),
            'routing_verified_at' => now(),
            'edge_eligible' => true,
            'tls_ready_at' => now(),
        ], $attributes));
        DomainClaims::prove((int) $domain->workspace_id, $domain->domain);

        return $domain;
    }

    private function link(CustomDomain $domain, string $alias, string $destination = 'https://brand.example.test/x'): Link
    {
        $workspace = Workspace::findOrFail($domain->workspace_id);

        return Link::create([
            'workspace_id' => $workspace->id,
            'created_by' => (int) $workspace->owner_user_id,
            'alias' => $alias,
            'destination' => $destination,
            'domain_id' => $domain->id,
        ]);
    }
}
