<?php

namespace Tests\Feature;

use App\Models\CustomDomain;
use App\Models\User;
use App\Models\Workspace;
use App\Support\AppProviders;
use App\Support\DomainClaims;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;
use Tests\TestCase;

final class AppOpeningTest extends TestCase
{
    private Workspace $workspace;

    private CustomDomain $domain;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, audit_events RESTART IDENTITY CASCADE');
        Queue::fake();
        config(['app_links.providers' => true, 'app_links.native' => true, 'workflows.enabled' => true, 'uvh.public_origin' => 'https://uvh.es']);
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'app-csrf')->withHeader('X-CSRF-Token', 'app-csrf');
        $user = User::factory()->create(['email_verified_at' => now()]);
        $this->workspace = $user->ownedWorkspaces()->create(['name' => 'Apps', 'slug' => Ids::randomToken(12)]);
        $this->workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
        $this->withCookie((string) config('uvh.session_cookie'), SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $this->workspace->id);
        $this->withHeader('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1');
        $this->domain = CustomDomain::create(['workspace_id' => $this->workspace->id, 'domain' => 'apps.example.test', 'verification_token' => 'uvh-verify=fixture', 'verification_version' => 1, 'verification_scheme' => 2, 'desired_state' => 'enabled', 'ownership_status' => 'verified', 'routing_status' => 'healthy', 'tls_status' => 'ready', 'verified_at' => now(), 'ownership_verified_at' => now(), 'routing_verified_at' => now(), 'edge_eligible' => true, 'tls_ready_at' => now()]);
        DomainClaims::prove((int) $this->workspace->id, $this->domain->domain);
    }

    private function provider(): array
    {
        return ['version' => 1, 'kind' => 'provider', 'provider' => 'spotify', 'url' => 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=tracking'];
    }

    private function link(array $extra = []): array
    {
        return $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/links', array_replace(['destination' => 'https://example.org/fallback', 'appOpening' => $this->provider()], $extra))->assertCreated()->json('link');
    }

    private function profile(): array
    {
        return $this->withHeader('Idempotency-Key', (string) Str::uuid())->patchJson('/api/v1/domains/'.$this->domain->id.'/app-profile', ['version' => 0, 'name' => 'Tienda', 'enabled' => true, 'iosAppId' => 'ABCDE12345.es.empresa.app', 'androidPackage' => 'es.empresa.app', 'androidFingerprints' => [implode(':', array_fill(0, 32, 'AB'))], 'routePrefixes' => ['/productos/']])->assertOk()->json('profile');
    }

    private function native(array $extra = []): array
    {
        $profile = $this->profile();
        $link = $this->link($extra + ['domainId' => $this->domain->id, 'appOpening' => ['version' => 1, 'kind' => 'native', 'profileId' => $profile['id'], 'route' => '/productos/123']]);

        return [$link, ['launchUrl' => $link['appLaunchUrl'], 'profileId' => $profile['id'], 'attemptId' => (string) Str::uuid()]];
    }

    private function challenge(array $body): array
    {
        $result = $this->postJson('https://apps.example.test/api/v1/app-links/resolve', $body)->assertStatus(202)->assertJsonPath('kind', 'challenge_required');

        return $body + ['challenge' => $result->json('challenge')];
    }

    public function test_domain_reassignment_revokes_native_access_and_preserves_the_web_link(): void
    {
        [$link, $body] = $this->native();
        $body = $this->challenge($body);
        $grant = $this->postJson('https://apps.example.test/api/v1/app-links/resolve', $body)
            ->assertOk()->assertJsonPath('kind', 'content')->json('grant');
        $this->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/domains/'.$this->domain->id.'/reassign', [
                'linkIds' => [$link['id']], 'targetDomainId' => null,
                'expectedVersions' => [['id' => $link['id'], 'version' => $link['version']]],
            ])->assertOk()->assertJsonPath('applied', 1);
        $this->postJson('https://apps.example.test/api/v1/app-links/resolve', $body + ['grant' => $grant])
            ->assertStatus(404)->assertJsonPath('kind', 'unavailable');
        $current = $this->getJson('/api/v1/links/'.$link['id'])->assertOk()->json('link');
        $this->assertNull($current['appLaunchUrl']);
        $this->assertSame($current['shortUrl'], $current['shareUrl']);
        $this->get($current['shortUrl'])->assertRedirect('https://example.org/fallback');
        $this->deleteJson('/api/v1/domains/'.$this->domain->id)->assertOk();
        $this->assertDatabaseMissing('app_link_profiles', ['domain_id' => $this->domain->id]);
        $this->get($current['shortUrl'])->assertRedirect('https://example.org/fallback');
    }

    public function test_provider_page_and_continuation_consume_one_single_use_visit(): void
    {
        $link = $this->link(['singleUse' => true]);
        $page = $this->get('https://uvh.es/'.$link['alias'])->assertOk()->assertSee('Continúa en Spotify')->assertSee('Abrir destino web');
        $cookie = array_values(array_filter($page->headers->getCookies(), fn ($c) => $c->getName() === 'uvh_app_continue'))[0];
        $body = ['alias' => $link['alias'], 'grant' => $cookie->getValue(), 'choice' => 'web'];
        $this->post('https://uvh.es/app-links/continue', $body)->assertStatus(303)->assertRedirect('https://example.org/fallback');
        self::assertSame(1, DB::table('links')->where('id', $link['id'])->value('click_count'));
        self::assertSame(1, DB::table('click_events')->where('link_id', $link['id'])->count());
        $this->get('https://uvh.es/'.$link['alias'])->assertGone();
    }

    public function test_head_and_social_fetchers_do_not_consume_even_when_social_cards_are_disabled(): void
    {
        config(['sharing.social_previews' => false]);
        $link = $this->link(['singleUse' => true]);
        $this->head('https://uvh.es/'.$link['alias'])->assertStatus(302);
        $this->withHeader('User-Agent', 'Twitterbot/1.0')->get('https://uvh.es/'.$link['alias'])->assertStatus(302);
        self::assertSame(0, DB::table('click_events')->count());
        self::assertSame(0, DB::table('links')->where('id', $link['id'])->value('click_count'));
    }

    public function test_native_retries_and_grants_do_not_consume_twice_and_revocation_is_live(): void
    {
        [$link, $body] = $this->native(['singleUse' => true]);
        $body = $this->challenge($body);
        $result = $this->postJson('https://apps.example.test/api/v1/app-links/resolve', $body)->assertOk()->assertJsonPath('kind', 'content')->assertJsonPath('route', '/productos/123');
        $this->postJson('https://apps.example.test/api/v1/app-links/resolve', $body)->assertOk()->assertJsonPath('kind', 'content');
        self::assertSame(1, DB::table('click_events')->count());
        self::assertSame(1, DB::table('links')->where('id', $link['id'])->value('click_count'));
        DB::table('app_link_profiles')->where('domain_id', $this->domain->id)->update(['enabled' => false, 'version' => 2]);
        $this->postJson('https://apps.example.test/api/v1/app-links/resolve', $body + ['grant' => $result->json('grant')])->assertNotFound()->assertJsonPath('kind', 'unavailable');
    }

    public function test_password_requires_explicit_challenge_and_never_uses_panel_or_unlock_cookies(): void
    {
        [$link, $body] = $this->native(['password' => 'correct-password']);
        $body = $this->challenge($body);
        $this->postJson('https://apps.example.test/api/v1/app-links/resolve', $body)->assertUnauthorized()->assertJsonPath('kind', 'password_required');
        $this->postJson('https://apps.example.test/api/v1/app-links/resolve', $body + ['password' => 'wrong'])->assertUnauthorized();
        self::assertSame(0, DB::table('click_events')->count());
        $this->postJson('https://apps.example.test/api/v1/app-links/resolve', $body + ['password' => 'correct-password'])->assertOk()->assertJsonPath('kind', 'content');
    }

    public function test_association_documents_restrict_paths_and_do_not_generate_visits(): void
    {
        $this->profile();
        $this->get('https://apps.example.test/.well-known/apple-app-site-association')->assertOk()->assertJsonPath('applinks.details.0.paths.0', '/a/*');
        $this->get('https://apps.example.test/.well-known/assetlinks.json')->assertOk()->assertJsonPath('0.target.package_name', 'es.empresa.app');
        $this->get('https://uvh.es/.well-known/assetlinks.json')->assertNotFound();
        self::assertSame(0, DB::table('click_events')->count());
    }

    public function test_provider_urls_cannot_inject_schemes_credentials_or_foreign_hosts(): void
    {
        foreach (['intent://evil', 'https://open.spotify.com.evil.test/track/4uLU6hMCjMI75M1A2tKUQC', 'https://user@open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', 'javascript:alert(1)'] as $url) {
            $this->postJson('/api/v1/links', ['destination' => 'https://example.org', 'appOpening' => array_replace($this->provider(), ['url' => $url])])->assertUnprocessable();
        }
        self::assertSame('https://www.youtube.com/watch?v=dQw4w9WgXcQ', AppProviders::normalize('youtube', 'https://youtu.be/dQw4w9WgXcQ'));
    }

    public function test_invalid_native_route_profile_and_workspace_are_rejected(): void
    {
        $profile = $this->profile();
        foreach (['/productos/../admin', '//evil.test', '/productos/%2e%2e', '/productos/123?command=delete', '/admin/'] as $route) {
            $this->postJson('/api/v1/links', ['destination' => 'https://example.org', 'domainId' => $this->domain->id, 'appOpening' => ['version' => 1, 'kind' => 'native', 'profileId' => $profile['id'], 'route' => $route]])->assertUnprocessable();
        }
        $this->postJson('/api/v1/links', ['destination' => 'https://example.org', 'appOpening' => ['version' => 1, 'kind' => 'native', 'profileId' => $profile['id'], 'route' => '/productos/123']])->assertUnprocessable();
    }

    public function test_rules_keep_web_priority_and_plain_updates_preserve_config(): void
    {
        $link = $this->link(['rules' => [['priority' => 1, 'language' => 'es', 'destination' => 'https://example.org/spanish']]]);
        $this->withHeader('Accept-Language', 'es-ES')->get('https://uvh.es/'.$link['alias'])->assertRedirect('https://example.org/spanish');
        $this->patchJson('/api/v1/links/'.$link['id'], ['version' => $link['version'], 'name' => 'Changed'])->assertOk()->assertJsonPath('link.appOpening.kind', 'provider');
    }

    public function test_invalid_grants_and_missing_csrf_never_spend_an_ordinary_link(): void
    {
        $link = $this->link(['appOpening' => null, 'singleUse' => true]);
        $this->post('https://uvh.es/app-links/continue', ['alias' => $link['alias'], 'grant' => 'tampered', 'choice' => 'web'])->assertNotFound();
        self::assertNull(DB::table('links')->where('id', $link['id'])->value('used_at'));
        self::assertSame(0, DB::table('click_events')->count());
        $this->withoutHeader('X-CSRF-Token')->post('https://uvh.es/app-links/continue', ['alias' => $link['alias'], 'grant' => 'tampered', 'choice' => 'web'])->assertForbidden();
    }

    public function test_profile_changes_expiry_and_foreign_profiles_invalidate_resolution(): void
    {
        [$link, $body] = $this->native(['maxClicks' => 1]);
        $body = $this->challenge($body);
        $r = $this->postJson('https://apps.example.test/api/v1/app-links/resolve', $body)->assertOk();
        $this->postJson('https://apps.example.test/api/v1/app-links/resolve', $body + ['grant' => $r->json('grant')])->assertOk();
        $fresh = array_replace($body, ['attemptId' => (string) Str::uuid()]);
        unset($fresh['challenge']);
        $fresh = $this->challenge($fresh);
        $this->postJson('https://apps.example.test/api/v1/app-links/resolve', $fresh)->assertGone();
        DB::table('links')->where('id', $link['id'])->update(['expires_at' => now()->subSecond()]);
        $this->postJson('https://apps.example.test/api/v1/app-links/resolve', $body + ['grant' => $r->json('grant')])->assertNotFound();
        self::assertSame(1, DB::table('click_events')->count());
    }

    public function test_profile_mutations_are_versioned_idempotent_and_authorized(): void
    {
        $profile = $this->profile();
        $key = (string) Str::uuid();
        $body = array_diff_key($profile, ['id' => true]);
        $body['name'] = 'Nueva app';
        $this->withHeader('Idempotency-Key', $key)->patchJson('/api/v1/domains/'.$this->domain->id.'/app-profile', $body)->assertOk()->assertJsonPath('profile.version', 2);
        $this->patchJson('/api/v1/domains/'.$this->domain->id.'/app-profile', $body)->assertOk()->assertJsonPath('profile.version', 2);
        $this->withHeader('Idempotency-Key', (string) Str::uuid())->patchJson('/api/v1/domains/'.$this->domain->id.'/app-profile', $body)->assertConflict();
        DB::table('memberships')->where('workspace_id', $this->workspace->id)->update(['role' => 'viewer']);
        $this->getJson('/api/v1/domains/'.$this->domain->id.'/app-profile')->assertOk();
        $this->patchJson('/api/v1/domains/'.$this->domain->id.'/app-profile', $body)->assertForbidden();
    }

    public function test_native_password_attempts_share_the_browser_budget_but_challenges_do_not(): void
    {
        [$link, $body] = $this->native(['password' => 'correct-password']);
        for ($i = 0; $i < 12; $i++) {
            $this->postJson('https://apps.example.test/api/v1/app-links/resolve', $body)->assertStatus(202);
        }
        $body = $this->challenge($body);
        for ($i = 0; $i < 10; $i++) {
            $this->postJson('https://apps.example.test/api/v1/app-links/resolve', $body + ['password' => 'wrong'])->assertUnauthorized();
        }
        $this->postJson('https://apps.example.test/api/v1/app-links/resolve', $body + ['password' => 'wrong'])->assertStatus(429)->assertJsonPath('kind', 'rate_limited');
        $this->post('https://apps.example.test/r/'.$link['alias'].'/unlock', ['password' => 'wrong'])->assertStatus(429);
        self::assertSame(0, DB::table('click_events')->count());
    }

    public function test_native_paths_and_origins_cannot_resolve_foreign_urls(): void
    {
        [$link, $body] = $this->native();
        foreach (['https://evil.test/a/x', 'https://user@apps.example.test/a/x', 'https://apps.example.test/app/settings', 'http://apps.example.test/a/x', 'https://apps.example.test/a/x?redirect=https://evil.test'] as $url) {
            $this->postJson('https://apps.example.test/api/v1/app-links/resolve', array_replace($body, ['launchUrl' => $url]))->assertUnprocessable();
        }
        $this->withHeader('Origin', 'https://evil.test')->postJson('https://apps.example.test/api/v1/app-links/resolve', $body)->assertForbidden();
        self::assertSame(0, DB::table('click_events')->count());
    }

    public function test_qr_attribution_is_kept_on_native_retries(): void
    {
        [$link, $body] = $this->native();
        $design = ['version' => 1, 'foreground' => '#262821', 'background' => '#FFFFFF', 'correction' => 'H', 'quietZone' => 4, 'logo' => ['kind' => 'uvh'], 'frame' => 'none', 'caption' => ''];
        $variant = $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/links/'.$link['id'].'/qr-variants', ['name' => 'Cartel', 'spec' => $design])->assertCreated()->json('variant');
        $body['launchUrl'] .= '?qr='.$variant['publicId'];
        $body = $this->challenge($body);
        $this->postJson('https://apps.example.test/api/v1/app-links/resolve', $body)->assertOk();
        $this->postJson('https://apps.example.test/api/v1/app-links/resolve', $body)->assertOk();
        self::assertSame(1, DB::table('click_events')->where('qr_variant_id', $variant['id'])->count());
        self::assertSame(1, (int) DB::table('qr_daily_counts')->where('variant_id', $variant['id'])->sum('visits'));
    }

    public function test_legacy_history_preserves_app_settings_and_new_snapshots_exclude_secrets(): void
    {
        $link = $this->link(['password' => 'never-in-history']);
        $snapshot = json_decode(DB::table('link_versions')->where('link_id', $link['id'])->value('configuration'), true);
        self::assertSame('provider', $snapshot['appOpening']['kind']);
        self::assertStringNotContainsString('never-in-history', json_encode($snapshot));
        self::assertArrayNotHasKey('password_hash', $snapshot);
        unset($snapshot['appOpening']);
        DB::table('link_versions')->where('link_id', $link['id'])->update(['configuration' => json_encode($snapshot)]);
        $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/links/'.$link['id'].'/history/1/restore', ['expectedVersion' => $link['version']])->assertOk()->assertJsonPath('link.appOpening.kind', 'provider');
    }

    public function test_feature_flags_are_independent_and_desktop_uses_web(): void
    {
        $profile = $this->profile();
        config(['app_links.native' => false]);
        $this->postJson('/api/v1/links', ['destination' => 'https://example.org', 'domainId' => $this->domain->id, 'appOpening' => ['version' => 1, 'kind' => 'native', 'profileId' => $profile['id'], 'route' => '/productos/123']])->assertUnprocessable();
        $link = $this->link();
        $this->withHeader('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36')->get('https://uvh.es/'.$link['alias'])->assertRedirect('https://example.org/fallback');
    }

    public function test_concurrent_retries_commit_one_admission_and_one_visit(): void
    {
        [$link, $body] = $this->native(['singleUse' => true]);
        $connection = config('database.connections.pgsql');
        $environment = ['APP_ENV' => 'testing', 'APP_KEY' => (string) config('app.key'), 'DB_CONNECTION' => 'pgsql', 'DB_HOST' => (string) $connection['host'], 'DB_PORT' => (string) $connection['port'], 'DB_DATABASE' => DB::connection()->getDatabaseName(), 'DB_USERNAME' => (string) $connection['username'], 'DB_PASSWORD' => (string) $connection['password'], 'QUEUE_CONNECTION' => 'sync', 'CACHE_STORE' => 'array', 'PUBLIC_HOST' => (string) config('uvh.public_host')];
        $input = json_encode(['host' => $this->domain->domain, 'alias' => $link['alias'], 'profile' => $body['profileId'], 'attempt' => $body['attemptId'], 'at' => microtime(true) + 3], JSON_THROW_ON_ERROR);
        $workers = [];
        for ($i = 0; $i < 6; $i++) {
            $worker = new Process([PHP_BINARY, base_path('tests/Support/app-admission-probe.php')], base_path(), $environment);
            $worker->setInput($input);
            $worker->setTimeout(30);
            $worker->start();
            $workers[] = $worker;
        }
        $results = [];
        foreach ($workers as $worker) {
            $worker->wait();
            $result = json_decode($worker->getOutput(), true, 16, JSON_THROW_ON_ERROR);
            self::assertNull($result['error']);
            self::assertSame('app_opening', $result['kind']);
            $results[] = $result;
        }
        self::assertLessThan(min(array_column($results, 'end')), max(array_column($results, 'start')));
        self::assertSame(1, DB::table('app_link_admissions')->where('link_id', $link['id'])->count());
        self::assertSame(1, DB::table('click_events')->where('link_id', $link['id'])->count());
        self::assertSame(1, DB::table('links')->where('id', $link['id'])->value('click_count'));
    }

    public function test_disabled_profiles_use_web_sharing_and_old_clients_can_still_edit(): void
    {
        [$link] = $this->native();
        DB::table('app_link_profiles')->where('domain_id', $this->domain->id)->update(['enabled' => false, 'version' => 2]);
        $this->getJson('/api/v1/links/'.$link['id'])->assertOk()->assertJsonPath('link.appLaunchUrl', null)->assertJsonPath('link.shareUrl', $link['shortUrl']);
        $this->patchJson('/api/v1/links/'.$link['id'], ['version' => $link['version'], 'notes' => 'Legacy client'])->assertOk()->assertJsonPath('link.appOpening.kind', 'native');
        $this->get('https://apps.example.test/'.$link['alias'])->assertRedirect('https://example.org/fallback');
    }

    public function test_prepared_provider_anchor_requires_its_scoped_grant_and_revalidates(): void
    {
        $link = $this->link(['singleUse' => true]);
        $page = $this->get('https://uvh.es/'.$link['alias'])->assertOk();
        preg_match('~href="(/app-links/continue/[^"]+)"~', $page->getContent(), $matches);
        $href = html_entity_decode($matches[1]);
        $cookie = array_values(array_filter($page->headers->getCookies(), fn ($c) => $c->getName() === 'uvh_app_continue'))[0];
        self::assertTrue($cookie->isHttpOnly());
        self::assertStringStartsWith('/app-links/continue/', $cookie->getPath());
        $this->get('https://uvh.es'.$href)->assertNotFound();
        $this->withCookie('uvh_app_continue', $cookie->getValue())->get('https://uvh.es'.$href)->assertStatus(303)->assertRedirect('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
        DB::table('links')->where('id', $link['id'])->update(['state' => 'paused', 'version' => 2]);
        $this->get('https://uvh.es'.$href)->assertNotFound();
        self::assertSame(1, DB::table('links')->where('id', $link['id'])->value('click_count'));
        self::assertSame(1, DB::table('click_events')->count());
    }

    public function test_the_fixed_uvh_origin_resolves_only_current_managed_domains_and_profiles(): void
    {
        [$link, $body] = $this->native(['singleUse' => true]);
        $response = $this->postJson('https://uvh.es/api/v1/app-links/resolve', $body)->assertStatus(202);
        $body['challenge'] = $response->json('challenge');
        $this->postJson('https://uvh.es/api/v1/app-links/resolve', $body)->assertOk()->assertJsonPath('kind', 'content');
        $this->postJson('https://uvh.es/api/v1/app-links/resolve', $body)->assertOk();
        self::assertSame(1, DB::table('click_events')->count());
        $this->domain->update(['desired_state' => 'disabled', 'edge_eligible' => false]);
        $this->postJson('https://uvh.es/api/v1/app-links/resolve', $body)->assertNotFound()->assertJsonPath('kind', 'unavailable');
        self::assertSame(1, DB::table('click_events')->count());
    }

    public function test_the_central_resolver_does_not_contact_foreign_hosts_or_trust_workspace_headers(): void
    {
        [$link, $body] = $this->native();
        $this->postJson('https://uvh.es/api/v1/app-links/resolve', array_replace($body, ['launchUrl' => 'https://169.254.169.254/a/metadata']))->assertNotFound();
        $this->withHeader('X-Workspace-Id', '999999')->postJson('https://uvh.es/api/v1/app-links/resolve', $body)->assertStatus(202);
        $wrong = array_replace($body, ['profileId' => (string) Str::uuid()]);
        $challenge = $this->postJson('https://uvh.es/api/v1/app-links/resolve', $wrong)->assertStatus(202)->json('challenge');
        $this->postJson('https://uvh.es/api/v1/app-links/resolve', $wrong + ['challenge' => $challenge])->assertNotFound();
        self::assertSame(0, DB::table('click_events')->count());
    }

    public function test_central_and_domain_password_attempts_share_one_budget(): void
    {
        [$link, $body] = $this->native(['password' => 'correct-password']);
        $body['challenge'] = $this->postJson('https://uvh.es/api/v1/app-links/resolve', $body)->assertStatus(202)->json('challenge');
        for ($i = 0; $i < 10; $i++) {
            $this->postJson('https://uvh.es/api/v1/app-links/resolve', $body + ['password' => 'wrong'])->assertUnauthorized();
        }
        $this->post('https://apps.example.test/r/'.$link['alias'].'/unlock', ['password' => 'wrong'])->assertStatus(429);
        $this->postJson('https://apps.example.test/api/v1/app-links/resolve', $body + ['password' => 'wrong'])->assertStatus(429);
        self::assertSame(0, DB::table('click_events')->count());
    }
}
