<?php

namespace Tests\Feature;

use App\Models\Link;
use App\Models\User;
use App\Support\Ids;
use App\Support\Language;
use App\Support\LinkService;
use App\Support\SessionManager;
use App\Support\VisitorAnswer;
use App\Support\VisitorPage;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class LanguagePreferenceTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'language-test')->withHeader('X-CSRF-Token', 'language-test');
    }

    public function test_preference_requires_a_session_and_is_personal(): void
    {
        $this->patchJson('/api/v1/auth/language', ['language' => 'en'])->assertUnauthorized();
        $user = User::factory()->create(['email_verified_at' => now()]);
        $other = User::factory()->create(['email_verified_at' => now()]);
        $session = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true);
        $this->withCookie('uvh_session', $session);
        $this->patchJson('/api/v1/auth/language', ['language' => 'en'])->assertOk()->assertExactJson(['language' => 'en']);
        $this->assertSame('en', $user->fresh()->language);
        $this->assertNull($other->fresh()->language);
        $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('user.language', 'en');
        $this->patchJson('/api/v1/auth/language', ['language' => '../../en'])->assertStatus(422);
        $this->assertSame('en', $user->fresh()->language);
    }

    public function test_root_negotiates_but_an_explicit_locale_wins(): void
    {
        config(['uvh.localisation_enabled' => true, 'uvh.public_host' => 'uvh.test']);
        $response = $this->withHeader('Accept-Language', 'fr-FR,en-GB;q=0.9,es;q=0.4')->get('http://uvh.test/');
        $response->assertStatus(302)->assertHeader('Location', '/en/')->assertHeader('Vary', 'Accept-Language, Cookie');
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
        $this->withCookie('uvh_language', 'es')->get('http://uvh.test/')->assertHeader('Location', '/es/');
        $request = Request::create('http://uvh.test/en/help', 'GET', [], ['uvh_language' => 'es'], [], ['HTTP_ACCEPT_LANGUAGE' => 'es']);
        $this->assertSame('en', Language::fromRequest($request));
        $this->withHeader('Accept-Language', 'en')->get('http://uvh.test/r/no-such-alias')->assertStatus(404)->assertHeaderMissing('Location');
    }

    public function test_localisation_audit_is_read_only_and_accepts_an_empty_library(): void
    {
        $this->artisan('uvh:localisation-audit')->assertSuccessful();
        // Schema fixtures for actual links are covered by the link suites;
        // this check deliberately performs no repair or automatic alias rename.
        $this->assertSame(0, DB::table('users')->count());
    }

    public function test_language_prefixes_are_reserved_only_for_new_public_aliases(): void
    {
        config(['uvh.localisation_enabled' => true]);
        foreach (['es', 'en', 'ES', 'EN'] as $alias) {
            $this->assertFalse(LinkService::validate(['alias' => $alias, 'destination' => 'https://example.org'])['ok']);
            $this->assertTrue(LinkService::validate(['alias' => $alias, 'domain_id' => 17, 'destination' => 'https://example.org'])['ok']);
        }
        $owner = User::factory()->create();
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Collision', 'slug' => Ids::randomToken(12)]);
        $link = Link::create(['workspace_id' => $workspace->id, 'created_by' => $owner->id, 'alias' => 'en', 'destination' => 'https://example.org', 'state' => 'active']);
        $this->artisan('uvh:localisation-audit')->assertFailed();
        $this->assertSame('en', $link->fresh()->alias);
        $this->assertSame(1, Link::where('workspace_id', $workspace->id)->count());
    }

    public function test_custom_domain_alias_is_not_interpreted_as_an_interface_language(): void
    {
        $request = Request::create('https://customer.test/en', 'GET', [], [], [], ['HTTP_ACCEPT_LANGUAGE' => 'es']);
        $this->assertFalse(Language::isFirstPartyHost($request->getHost()));
        $this->assertSame('es', Language::fromRequest($request, false));
        $this->assertSame('/en/auth/verify-email#token=Opaque_1&next=2', Language::path('/es/auth/verify-email#token=Opaque_1&next=2', 'en'));
        $this->assertSame('/es/ayuda?q=opaque%20value#section', Language::path('/help?q=opaque%20value#section', 'es'));
    }

    public function test_sitemap_has_reciprocal_language_alternatives_and_excludes_private_routes(): void
    {
        config(['uvh.localisation_enabled' => true, 'uvh.public_origin' => 'https://uvh.test']);
        $xml = $this->get('/sitemap.xml')->assertOk()->getContent();
        $this->assertSame(12, substr_count($xml, '<url>'));
        foreach (['/es/ayuda', '/en/help', '/es/legal/privacidad', '/en/legal/privacy'] as $path) {
            $this->assertStringContainsString('https://uvh.test'.$path, $xml);
        }
        $this->assertSame(12, substr_count($xml, 'hreflang="x-default"'));
        $this->assertStringNotContainsString('/auth/', $xml);
        $this->get('/robots.txt')->assertOk()->assertSee('Disallow: /en/auth/', false)->assertSee('Disallow: /es/app/', false);
    }

    public function test_visitor_pages_translate_system_copy_and_keep_owner_content_literal(): void
    {
        config(['uvh.localisation_enabled' => true]);
        app()->setLocale('en_GB');
        $gate = VisitorPage::gate('safe-alias', 'csrf-fixture');
        $this->assertStringContainsString('<html lang="en-GB">', $gate);
        $this->assertStringContainsString('This link is password-protected.', $gate);
        $this->assertStringContainsString('action="/r/safe-alias/unlock"', $gate);
        $notice = VisitorPage::notice('Mensaje del propietario', 'Mi contenido sin traducir', 404);
        $this->assertStringContainsString('Mensaje del propietario', $notice);
        $this->assertStringContainsString('Mi contenido sin traducir', $notice);
        $this->assertStringContainsString('You can ask the person who shared it for a new link.', $notice);
        $missing = VisitorAnswer::notFound()->getContent();
        $this->assertStringContainsString('/en/help', $missing);
        $this->assertStringContainsString('/en/legal/privacy', $missing);
        $this->assertStringContainsString('/en/app/dashboard', $missing);
        $this->assertStringNotContainsString('/en/r/', $gate);
    }
}
