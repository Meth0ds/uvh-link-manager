<?php

namespace Tests\Feature;

use App\Models\CustomDomain;
use App\Models\User;
use App\Models\Workspace;
use App\Support\DomainClaims;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\SocialAssetCleanup;
use App\Support\SocialPreview;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class SocialPreviewTest extends TestCase
{
    private Workspace $workspace;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, audit_events RESTART IDENTITY CASCADE');
        DB::table('social_preview_asset_cleanup_receipts')->truncate();
        Queue::fake();
        Storage::fake('local');
        config(['sharing.social_previews' => true, 'workflows.enabled' => true]);
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'social-csrf')->withHeader('X-CSRF-Token', 'social-csrf');
        $user = User::factory()->create(['email_verified_at' => now()]);
        $this->workspace = $user->ownedWorkspaces()->create(['name' => 'Social', 'slug' => Ids::randomToken(12)]);
        $this->workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
        $this->withCookie((string) config('uvh.session_cookie'), SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $this->workspace->id);
    }

    private function spec(?int $asset = null): array
    {
        return ['version' => 1, 'enabled' => true, 'title' => 'Campaña <script>alert(1)</script>', 'description' => 'Descripción pública', 'imageAssetId' => $asset, 'imageAlt' => 'Imagen pública'];
    }

    private function link(array $extra = []): array
    {
        return $this->withHeader('Idempotency-Key', Ids::randomToken(16))->postJson('/api/v1/links', array_replace(['destination' => 'https://example.org/private?secret=not-public', 'singleUse' => true, 'socialPreview' => $this->spec()], $extra))->assertCreated()->json('link');
    }

    public function test_fetchers_receive_escaped_metadata_without_consuming_single_use_or_statistics(): void
    {
        $link = $this->link();
        self::assertNotNull(SocialPreview::lookup('uvh.es', $link['alias']));
        self::assertSame('active', DB::table('links')->where('id', $link['id'])->value('state'));
        $this->withHeader('User-Agent', 'Twitterbot/1.0')->get('http://uvh.es/'.$link['alias'])->assertOk()->assertSee('og:title', false)->assertSee('&lt;script&gt;', false)->assertDontSee('not-public', false)->assertDontSee('<script>', false);
        $this->withHeader('User-Agent', 'facebookexternalhit/1.1')->head('http://uvh.es/r/'.$link['alias'])->assertOk();
        self::assertSame(0, DB::table('links')->where('id', $link['id'])->value('click_count'));
        self::assertNull(DB::table('links')->where('id', $link['id'])->value('used_at'));
        self::assertSame(0, DB::table('click_events')->count());
        $this->withHeader('User-Agent', 'Mozilla/5.0')->get('http://uvh.es/'.$link['alias'])->assertRedirect('https://example.org/private?secret=not-public');
        self::assertNotNull(DB::table('links')->where('id', $link['id'])->value('used_at'));
    }

    public function test_old_mixed_case_aliases_still_resolve_without_changing_printed_urls(): void
    {
        $link = $this->link(['singleUse' => false]);
        DB::table('links')->where('id', $link['id'])->update(['alias' => 'OlderMixedAlias']);
        $this->withHeader('User-Agent', 'Twitterbot/1.0')->get('http://uvh.es/OlderMixedAlias')->assertOk();
        $this->withHeader('User-Agent', 'Mozilla/5.0')->get('http://uvh.es/oldermixedalias')->assertRedirect('https://example.org/private?secret=not-public');
        self::assertSame('OlderMixedAlias', DB::table('links')->where('id', $link['id'])->value('alias'));
    }

    public function test_in_app_browsers_are_not_mistaken_for_social_fetchers(): void
    {
        self::assertFalse(SocialPreview::isFetcher('Mozilla/5.0 WhatsApp/2.24.1'));
        self::assertFalse(SocialPreview::isFetcher('Mozilla/5.0 Googlebot'));
        self::assertTrue(SocialPreview::isFetcher('WhatsApp/2.24.1 A'));
        self::assertTrue(SocialPreview::isFetcher('LinkedInBot/1.0'));
    }

    public function test_custom_domain_cards_preserve_only_the_links_own_qr_variant_without_attribution(): void
    {
        $domain = CustomDomain::create(['workspace_id' => $this->workspace->id, 'domain' => 'social.example.test', 'verification_token' => 'uvh-verify=fixture', 'verification_version' => 1, 'verification_scheme' => 2, 'desired_state' => 'enabled', 'ownership_status' => 'verified', 'routing_status' => 'healthy', 'tls_status' => 'ready', 'verified_at' => now(), 'ownership_verified_at' => now(), 'routing_verified_at' => now(), 'edge_eligible' => true, 'tls_ready_at' => now()]);
        DomainClaims::prove((int) $this->workspace->id, $domain->domain);
        $link = $this->link();
        DB::table('links')->where('id', $link['id'])->update(['domain_id' => $domain->id]);
        $design = ['version' => 1, 'foreground' => '#262821', 'background' => '#FFFFFF', 'correction' => 'H', 'quietZone' => 4, 'logo' => ['kind' => 'uvh'], 'frame' => 'none', 'caption' => ''];
        $variant = $this->withHeader('Idempotency-Key', Str::uuid()->toString())->postJson('/api/v1/links/'.$link['id'].'/qr-variants', ['name' => 'Cartel', 'spec' => $design])->assertCreated()->json('variant.publicId');
        $this->withHeader('User-Agent', 'Twitterbot/1.0')->get('https://social.example.test/'.$link['alias'].'?qr='.$variant)->assertOk()->assertSee('https://social.example.test/'.$link['alias'].'?qr='.$variant, false);
        $this->get('https://social.example.test/'.$link['alias'].'?qr='.str_repeat('a', 32))->assertOk()->assertDontSee('?qr=', false);
        self::assertSame(0, DB::table('qr_daily_counts')->count());
        self::assertSame(0, DB::table('click_events')->count());
        self::assertNull(DB::table('links')->where('id', $link['id'])->value('used_at'));
        $domain->update(['desired_state' => 'disabled', 'edge_eligible' => false]);
        $this->get('https://social.example.test/'.$link['alias'].'?qr='.$variant)->assertNotFound()->assertDontSee('Descripción pública');
    }

    public function test_restoring_a_legacy_revision_without_social_data_keeps_the_current_card(): void
    {
        $link = $this->link();
        $snapshot = json_decode(DB::table('link_versions')->where('link_id', $link['id'])->where('revision', 1)->value('configuration'), true);
        unset($snapshot['socialPreview']);
        DB::table('link_versions')->where('link_id', $link['id'])->where('revision', 1)->update(['configuration' => json_encode($snapshot)]);
        $this->withHeader('Idempotency-Key', Ids::randomToken(16))->postJson('/api/v1/links/'.$link['id'].'/history/1/restore', ['expectedVersion' => $link['version']])->assertOk()->assertJsonPath('link.socialPreview.title', $link['socialPreview']['title']);
    }

    public function test_password_and_unavailable_states_never_publish_custom_content(): void
    {
        $link = $this->link(['password' => 'Lluvia-sobre-los-pinos!']);
        $this->withHeader('User-Agent', 'Twitterbot/1.0')->get('http://uvh.es/'.$link['alias'])->assertOk()->assertSee('Enlace protegido')->assertDontSee('Descripción pública');
        foreach (['paused', 'archived', 'expired', 'blocked', 'scheduled', 'deleted'] as $state) {
            DB::table('links')->where('id', $link['id'])->update(['state' => $state, 'password_hash' => null]);
            $this->get('http://uvh.es/'.$link['alias'])->assertNotFound()->assertDontSee('Descripción pública');
        }
    }

    public function test_upload_normalizes_image_and_public_asset_is_bound_to_current_publication(): void
    {
        $upload = $this->withHeader('Idempotency-Key', Ids::randomToken(16))->post('/api/v1/social-preview-assets', ['image' => UploadedFile::fake()->image('picture.png', 1200, 630)])->assertCreated();
        $asset = $upload->json('asset.id');
        $private = $this->get('/api/v1/social-preview-assets/'.$asset)->assertOk();
        self::assertSame([1200, 630], array_slice(getimagesizefromstring($private->getContent()), 0, 2));
        self::assertSame('image/jpeg', $private->headers->get('Content-Type'));
        $link = $this->link(['socialPreview' => $this->spec($asset)]);
        $row = DB::table('links')->where('id', $link['id'])->first();
        $assetRow = DB::table('social_preview_assets')->where('id', $asset)->first();
        $path = 'http://uvh.es/.well-known/uvh-social/'.$row->social_public_id.'/'.$assetRow->public_id.'.jpg';
        $this->get($path)->assertOk();
        DB::table('links')->where('id', $link['id'])->update(['password_hash' => 'protected']);
        $this->get($path)->assertNotFound();
        self::assertNull(DB::table('links')->where('id', $link['id'])->value('used_at'));
    }

    public function test_false_images_bad_crops_and_foreign_references_are_rejected(): void
    {
        $this->withHeader('Idempotency-Key', Ids::randomToken(16))->post('/api/v1/social-preview-assets', ['image' => UploadedFile::fake()->createWithContent('fake.png', '<svg onload="alert(1)"></svg>')])->assertUnprocessable();
        $this->withHeader('Idempotency-Key', Ids::randomToken(16))->post('/api/v1/social-preview-assets', ['image' => UploadedFile::fake()->image('picture.png', 600, 400), 'crop' => json_encode(['x' => -1, 'y' => 0, 'width' => 600, 'height' => 315])])->assertUnprocessable();
        $this->withHeader('Idempotency-Key', Ids::randomToken(16))->postJson('/api/v1/links', ['destination' => 'https://example.org', 'socialPreview' => $this->spec(99999)])->assertUnprocessable();
    }

    public function test_edits_duplicates_and_history_preserve_and_restore_the_card(): void
    {
        $link = $this->link();
        $updated = $this->patchJson('/api/v1/links/'.$link['id'], ['version' => $link['version'], 'name' => 'Nuevo nombre'])->assertOk()->json('link');
        self::assertSame($link['socialPreview'], $updated['socialPreview']);
        $copy = $this->withHeader('Idempotency-Key', Str::uuid()->toString())->postJson('/api/v1/links/'.$link['id'].'/duplicate', ['sourceVersion' => $updated['version']])->assertCreated()->json('link');
        self::assertSame($link['socialPreview'], $copy['socialPreview']);
        $cleared = $this->patchJson('/api/v1/links/'.$link['id'], ['version' => $updated['version'], 'socialPreview' => null])->assertOk()->json('link');
        self::assertNull($cleared['socialPreview']);
        $this->withHeader('Idempotency-Key', Ids::randomToken(16))->postJson('/api/v1/links/'.$link['id'].'/history/1/restore', ['expectedVersion' => $cleared['version']])->assertOk()->assertJsonPath('link.socialPreview.title', $link['socialPreview']['title']);
    }

    public function test_cleanup_preserves_history_references_and_handles_workspace_cascade(): void
    {
        $asset = $this->withHeader('Idempotency-Key', Ids::randomToken(16))->post('/api/v1/social-preview-assets', ['image' => UploadedFile::fake()->image('picture.png', 1200, 630)])->assertCreated()->json('asset.id');
        $link = $this->link(['socialPreview' => $this->spec($asset)]);
        $this->patchJson('/api/v1/links/'.$link['id'], ['version' => $link['version'], 'socialPreview' => null])->assertOk();
        DB::table('social_preview_assets')->where('id', $asset)->update(['updated_at' => now()->subDays(2)]);
        self::assertSame(0, SocialAssetCleanup::run());
        $path = DB::table('social_preview_assets')->where('id', $asset)->value('path');
        DB::table('workspaces')->where('id', $this->workspace->id)->delete();
        self::assertSame(1, DB::table('social_preview_asset_cleanup_receipts')->count());
        SocialAssetCleanup::run();
        Storage::disk('local')->assertMissing($path);
    }
}
