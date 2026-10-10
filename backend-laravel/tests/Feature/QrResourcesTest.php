<?php

namespace Tests\Feature;

use App\Models\CustomDomain;
use App\Models\Link;
use App\Models\User;
use App\Models\Workspace;
use App\Support\AccountExportDocument;
use App\Support\AnalyticsService;
use App\Support\DomainClaims;
use App\Support\Ids;
use App\Support\QrAssetCleanup;
use App\Support\RedirectService;
use App\Support\SessionManager;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class QrResourcesTest extends TestCase
{
    private array $spec = ['version' => 1, 'foreground' => '#262821', 'background' => '#FFFFFF', 'correction' => 'H', 'quietZone' => 4, 'logo' => ['kind' => 'uvh'], 'frame' => 'none', 'caption' => ''];

    private User $owner;

    private Workspace $workspace;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, audit_events RESTART IDENTITY CASCADE');
        // Cleanup receipts deliberately survive account/workspace cascades.
        DB::table('qr_asset_cleanup_receipts')->delete();
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'qr-csrf')->withHeaders(['X-CSRF-Token' => 'qr-csrf']);
        $this->owner = User::factory()->create(['email_verified_at' => now()]);
        $this->workspace = $this->owner->ownedWorkspaces()->create(['name' => 'QR', 'slug' => 'qr-'.Ids::randomToken(8)]);
        $this->workspace->memberships()->create(['user_id' => $this->owner->id, 'role' => 'owner']);
        $this->signIn($this->owner);
        Storage::fake('qr-private');
    }

    private function signIn(User $user): void
    {
        $this->withCookie((string) config('uvh.session_cookie'), SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $this->workspace->id);
    }

    private function link(string $alias = 'qr-test'): Link
    {
        return Link::create(['workspace_id' => $this->workspace->id, 'created_by' => $this->owner->id, 'alias' => $alias, 'destination' => 'https://example.org/path?utm_source=original', 'state' => 'active']);
    }

    private function createDesign(): int
    {
        return (int) $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/qr-designs', ['name' => 'Carta', 'spec' => $this->spec])->assertCreated()->json('design.id');
    }

    public function test_designs_are_idempotent_versioned_and_never_save_link_urls(): void
    {
        $key = (string) Str::uuid();
        $this->withHeader('Idempotency-Key', $key);
        $body = ['name' => 'Carta', 'spec' => $this->spec];
        $one = $this->postJson('/api/v1/qr-designs', $body)->assertCreated()->json('design.id');
        $this->postJson('/api/v1/qr-designs', $body)->assertCreated()->assertJsonPath('design.id', $one);
        $this->postJson('/api/v1/qr-designs', ['name' => 'Otro', 'spec' => $this->spec])->assertStatus(409);
        $this->patchJson('/api/v1/qr-designs/'.$one, ['version' => 1, 'name' => 'Carta nueva'])->assertOk()->assertJsonPath('design.version', 2);
        $this->patchJson('/api/v1/qr-designs/'.$one, ['version' => 1, 'name' => 'Antiguo'])->assertStatus(409);
        $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/qr-designs', ['name' => 'Malicioso', 'spec' => $this->spec + ['url' => 'https://evil.test']])->assertStatus(422);
        $this->deleteJson('/api/v1/qr-designs/'.$one, ['version' => 1])->assertStatus(409);
        $this->deleteJson('/api/v1/qr-designs/'.$one, ['version' => 2])->assertOk();
        $this->withHeader('Idempotency-Key', $key)->postJson('/api/v1/qr-designs', $body)->assertStatus(410);
    }

    public function test_viewers_read_and_apply_but_cannot_write_and_other_workspaces_are_isolated(): void
    {
        $id = $this->createDesign();
        $viewer = User::factory()->create(['email_verified_at' => now()]);
        $this->workspace->memberships()->create(['user_id' => $viewer->id, 'role' => 'viewer']);
        $this->signIn($viewer);
        $this->getJson('/api/v1/qr-designs')->assertOk()->assertJsonCount(1, 'designs');
        $this->postJson('/api/v1/qr-designs', ['name' => 'Otra', 'spec' => $this->spec])->assertForbidden();
        $this->patchJson('/api/v1/qr-designs/'.$id, ['version' => 1, 'name' => 'Otra'])->assertForbidden();
        $this->deleteJson('/api/v1/qr-designs/'.$id, ['version' => 1])->assertForbidden();
        $other = $this->owner->ownedWorkspaces()->create(['name' => 'Otro', 'slug' => 'otro']);
        $other->memberships()->create(['user_id' => $viewer->id, 'role' => 'editor']);
        $this->withHeader('X-Workspace-Id', (string) $other->id);
        $this->getJson('/api/v1/qr-designs')->assertOk()->assertJsonCount(0, 'designs');
        $this->patchJson('/api/v1/qr-designs/'.$id, ['version' => 1, 'name' => 'Ataque'])->assertNotFound();
    }

    public function test_colors_text_logos_and_quota_are_validated_again_on_the_server(): void
    {
        foreach ([['foreground' => '#BBBBBB'], ['background' => '#000000'], ['caption' => '<img>'], ['caption' => "abc\u{202e}"], ['quietZone' => 1], ['logo' => ['kind' => 'custom', 'assetId' => 998]]] as $invalid) {
            $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/qr-designs', ['name' => 'Inválido', 'spec' => array_replace($this->spec, $invalid)])->assertStatus(422);
        }
        config(['qr.designs_per_workspace' => 1]);
        $this->createDesign();
        $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/qr-designs', ['name' => 'Otra', 'spec' => $this->spec])->assertStatus(409);
    }

    public function test_logo_normalization_rejects_svg_and_keeps_private_referenced_assets(): void
    {
        $bad = UploadedFile::fake()->createWithContent('false.png', '<svg onload="alert(1)"></svg>');
        $this->withHeader('Idempotency-Key', (string) Str::uuid())->post('/api/v1/qr-assets', ['logo' => $bad])->assertStatus(422);
        $good = UploadedFile::fake()->image('logo.jpg', 1400, 600);
        $assetId = $this->withHeader('Idempotency-Key', (string) Str::uuid())->post('/api/v1/qr-assets', ['logo' => $good])->assertCreated()->json('asset.id');
        $response = $this->get('/api/v1/qr-assets/'.$assetId)->assertOk()->assertHeader('Content-Type', 'image/png')->assertHeader('Cache-Control', 'no-store, private');
        $this->assertSame("\x89PNG\r\n\x1a\n", substr($response->getContent(), 0, 8));
        $size = getimagesizefromstring($response->getContent());
        $this->assertSame(1024, $size[0]);
        $this->spec['logo'] = ['kind' => 'custom', 'assetId' => $assetId];
        $design = $this->createDesign();
        $link = $this->link();
        $variant = $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/links/'.$link->id.'/qr-variants', ['name' => 'Carta impresa', 'spec' => $this->spec])->assertCreated()->json('variant');
        $this->deleteJson('/api/v1/qr-designs/'.$design, ['version' => 1])->assertOk();
        $this->assertSame((int) $assetId, (int) DB::table('qr_variants')->where('id', $variant['id'])->value('asset_id'));
        $this->get('/api/v1/qr-assets/'.$assetId)->assertOk();
    }

    public function test_workspace_erasure_collects_private_files_even_after_a_late_write(): void
    {
        $good = UploadedFile::fake()->image('logo.jpg', 200, 100);
        $id = $this->withHeader('Idempotency-Key', (string) Str::uuid())->post('/api/v1/qr-assets', ['logo' => $good])->assertCreated()->json('asset.id');
        $path = DB::table('qr_assets')->where('id', $id)->value('path');
        $this->spec['logo'] = ['kind' => 'custom', 'assetId' => $id];
        $this->createDesign();
        DB::table('workspaces')->where('id', $this->workspace->id)->delete();
        $this->assertSame(1, DB::table('qr_asset_cleanup_receipts')->where('path', $path)->count());
        QrAssetCleanup::run();
        Storage::disk('qr-private')->assertMissing($path);
        Storage::disk('qr-private')->put($path, 'late-fixture');
        $this->travel(61)->minutes();
        QrAssetCleanup::run();
        Storage::disk('qr-private')->assertMissing($path);
    }

    public function test_bulk_snapshot_is_bounded_complete_and_authorized(): void
    {
        $a = $this->link('first');
        $b = $this->link('second');
        $this->getJson('/api/v1/links/qr-export?ids='.$b->id.','.$a->id)->assertOk()->assertJsonPath('links.0.id', $b->id);
        $this->getJson('/api/v1/links/qr-export?ids='.$a->id.','.$a->id)->assertStatus(422);
        $this->getJson('/api/v1/links/qr-export?ids='.$a->id.',9999')->assertNotFound();
        $this->getJson('/api/v1/links/qr-export?ids[]=1')->assertStatus(422);
    }

    public function test_bulk_snapshot_accepts_100_links_and_refuses_101(): void
    {
        $ids = [];
        for ($i = 1; $i <= 101; $i++) {
            $ids[] = $this->link('bulk-'.$i)->id;
        }
        $this->getJson('/api/v1/links/qr-export?ids='.implode(',', array_slice($ids, 0, 100)))->assertOk()->assertJsonCount(100, 'links')->assertJsonPath('links.99.id', $ids[99]);
        $this->getJson('/api/v1/links/qr-export?ids='.implode(',', $ids))->assertStatus(422);
    }

    public function test_admins_and_editors_manage_shared_designs_and_campaigns(): void
    {
        $link = $this->link('roles');
        foreach (['admin', 'editor'] as $role) {
            $user = User::factory()->create(['email_verified_at' => now()]);
            $this->workspace->memberships()->create(['user_id' => $user->id, 'role' => $role]);
            $this->signIn($user);
            $id = $this->createDesign();
            $this->patchJson('/api/v1/qr-designs/'.$id, ['version' => 1, 'name' => $role])->assertOk();
            $this->deleteJson('/api/v1/qr-designs/'.$id, ['version' => 2])->assertOk();
            $variant = $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/links/'.$link->id.'/qr-variants', ['name' => $role, 'spec' => $this->spec])->assertCreated()->json('variant');
            $this->patchJson('/api/v1/links/'.$link->id.'/qr-variants/'.$variant['id'], ['version' => 1, 'archived' => true])->assertOk();
        }
    }

    public function test_campaign_attribution_is_exact_retry_safe_and_archiving_preserves_printed_qr(): void
    {
        $link = $this->link();
        $variant = $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/links/'.$link->id.'/qr-variants', ['name' => 'Mostrador', 'spec' => $this->spec])->assertCreated()->json('variant');
        $this->get('https://uvh.es/r/qr-test?qr='.$variant['publicId'])->assertRedirect('https://example.org/path?utm_source=original');
        $this->assertSame(1, (int) DB::table('qr_daily_counts')->sum('visits'));
        $this->assertSame($variant['id'], (int) DB::table('click_events')->value('qr_variant_id'));
        $this->patchJson('/api/v1/links/'.$link->id.'/qr-variants/'.$variant['id'], ['version' => 1, 'archived' => true])->assertOk();
        $this->get('https://uvh.es/r/qr-test?qr='.$variant['publicId'])->assertRedirect();
        $this->get('https://uvh.es/r/qr-test?qr='.str_repeat('a', 32))->assertRedirect();
        $this->assertSame(2, (int) DB::table('qr_daily_counts')->sum('visits'));
        $meta = ['country' => null, 'device' => null, 'browser' => null, 'os' => null, 'referrer_domain' => null, 'campaign' => 'utm-kept', 'visitor_hash' => null, 'qr_variant_id' => $variant['id']];
        $event = (string) Str::uuid();
        AnalyticsService::recordClick($link->id, $meta, $event);
        AnalyticsService::recordClick($link->id, $meta, $event);
        $this->assertSame(3, (int) DB::table('qr_daily_counts')->sum('visits'));
        $this->getJson('/api/v1/links/'.$link->id.'/qr-variants/comparison')->assertOk()->assertJsonPath('attributedVisits', 3)->assertJsonPath('unattributedVisits', 1);
        $link->update(['state' => 'paused']);
        $this->get('https://uvh.es/r/qr-test?qr='.$variant['publicId'])->assertNotFound();
        $this->assertSame(3, (int) DB::table('qr_daily_counts')->sum('visits'));
    }

    public function test_logo_orientation_padding_and_image_limits_are_normalized(): void
    {
        $image = imagecreatetruecolor(120, 80);
        imagealphablending($image, false);
        imagesavealpha($image, true);
        imagefill($image, 0, 0, imagecolorallocatealpha($image, 0, 0, 0, 127));
        imagefilledrectangle($image, 20, 10, 79, 49, imagecolorallocate($image, 20, 40, 60));
        ob_start();
        imagepng($image);
        $bytes = ob_get_clean();
        imagedestroy($image);
        $asset = $this->withHeader('Idempotency-Key', (string) Str::uuid())->post('/api/v1/qr-assets', ['logo' => UploadedFile::fake()->createWithContent('padding.png', $bytes)])->assertCreated()->json('asset');
        $this->assertSame(60, $asset['width']);
        $this->assertSame(40, $asset['height']);
        $jpegFile = UploadedFile::fake()->image('phone.jpg', 200, 100);
        $jpeg = file_get_contents($jpegFile->getPathname());
        $exif = "Exif\0\0II".pack('vVv', 42, 8, 1).pack('vvVvvV', 0x112, 3, 1, 6, 0, 0);
        $oriented = substr($jpeg, 0, 2)."\xff\xe1".pack('n', strlen($exif) + 2).$exif.substr($jpeg, 2);
        $asset = $this->withHeader('Idempotency-Key', (string) Str::uuid())->post('/api/v1/qr-assets', ['logo' => UploadedFile::fake()->createWithContent('phone.jpg', $oriented)])->assertCreated()->json('asset');
        $this->assertSame(100, $asset['width']);
        $this->assertSame(200, $asset['height']);
        $this->assertStringNotContainsString('Exif', $this->get('/api/v1/qr-assets/'.$asset['id'])->getContent());
        foreach ([UploadedFile::fake()->image('huge.jpg', 4097, 1), UploadedFile::fake()->createWithContent('fake.jpg', str_repeat('x', 2 * 1024 * 1024 + 1)), UploadedFile::fake()->createWithContent('truncated.png', "\x89PNG\r\n\x1a\n".str_repeat('x', 32))] as $bad) {
            $this->withHeader('Idempotency-Key', (string) Str::uuid())->post('/api/v1/qr-assets', ['logo' => $bad])->assertStatus(422);
        }
    }

    public function test_upload_retries_preserve_one_reservation_and_quota(): void
    {
        $file = UploadedFile::fake()->image('logo.png', 200, 100);
        $key = (string) Str::uuid();
        $this->withHeader('Idempotency-Key', $key);
        $one = $this->post('/api/v1/qr-assets', ['logo' => $file])->assertCreated()->json('asset.id');
        $this->post('/api/v1/qr-assets', ['logo' => $file])->assertCreated()->assertJsonPath('asset.id', $one);
        DB::table('qr_assets')->where('id', $one)->update(['status' => 'pending']);
        $this->post('/api/v1/qr-assets', ['logo' => $file])->assertCreated()->assertJsonPath('asset.id', $one);
        $this->assertSame(1, DB::table('qr_assets')->count());
        $this->assertSame('ready', DB::table('qr_assets')->where('id', $one)->value('status'));
        $this->post('/api/v1/qr-assets', ['logo' => UploadedFile::fake()->image('other.png', 30, 20)])->assertStatus(409);
        config(['qr.asset_bytes_per_workspace' => 1]);
        $this->withHeader('Idempotency-Key', (string) Str::uuid())->post('/api/v1/qr-assets', ['logo' => $file])->assertStatus(409);
        $this->assertSame(1, DB::table('qr_assets')->count());
    }

    public function test_failed_storage_write_leaves_a_retryable_collectable_reservation(): void
    {
        $file = UploadedFile::fake()->image('failure.png', 200, 100);
        $key = (string) Str::uuid();
        $manager = Storage::getFacadeRoot();
        $disk = \Mockery::mock(FilesystemAdapter::class);
        $disk->shouldReceive('put')->once()->andReturn(false);
        Storage::shouldReceive('disk')->with('qr-private')->andReturn($disk);
        try {
            $this->withHeader('Idempotency-Key', $key)->post('/api/v1/qr-assets', ['logo' => $file])->assertStatus(503);
        } finally {
            Storage::swap($manager);
        }
        $pending = DB::table('qr_assets')->first();
        $this->assertSame('pending', $pending->status);
        $this->post('/api/v1/qr-assets', ['logo' => $file])->assertCreated()->assertJsonPath('asset.id', $pending->id);
        $this->assertSame(1, DB::table('qr_assets')->count());
        $this->assertSame('ready', DB::table('qr_assets')->value('status'));
        $this->travel(2)->days();
        QrAssetCleanup::run();
        $this->assertSame(0, DB::table('qr_assets')->count());
        Storage::disk('qr-private')->assertMissing($pending->path);
    }

    public function test_permission_loss_during_logo_io_cannot_publish_the_asset(): void
    {
        $file = UploadedFile::fake()->image('revoke.png', 200, 100);
        $manager = Storage::getFacadeRoot();
        $realDisk = Storage::disk('qr-private');
        $disk = \Mockery::mock(FilesystemAdapter::class);
        $disk->shouldReceive('put')->once()->andReturnUsing(function ($path, $bytes) use ($realDisk): bool {
            DB::table('memberships')->where('workspace_id', $this->workspace->id)->where('user_id', $this->owner->id)->update(['role' => 'viewer']);

            return $realDisk->put($path, $bytes);
        });
        Storage::shouldReceive('disk')->with('qr-private')->andReturn($disk);
        try {
            $this->withHeader('Idempotency-Key', (string) Str::uuid())->post('/api/v1/qr-assets', ['logo' => $file])->assertForbidden();
        } finally {
            Storage::swap($manager);
        }
        $pending = DB::table('qr_assets')->first();
        $this->assertSame('pending', $pending->status);
        $this->get('/api/v1/qr-assets/'.$pending->id)->assertNotFound();
        $this->travel(2)->days();
        QrAssetCleanup::run();
        Storage::disk('qr-private')->assertMissing($pending->path);
    }

    public function test_reordered_design_fields_are_the_same_idempotent_creation(): void
    {
        $key = (string) Str::uuid();
        $this->withHeader('Idempotency-Key', $key);
        $first = $this->postJson('/api/v1/qr-designs', ['name' => 'Orden', 'spec' => $this->spec])->assertCreated()->json('design.id');
        $this->postJson('/api/v1/qr-designs', ['name' => 'Orden', 'spec' => array_reverse($this->spec, true)])->assertCreated()->assertJsonPath('design.id', $first);
    }

    public function test_password_gate_errors_and_continuation_preserve_campaign_attribution(): void
    {
        $link = $this->link('protected');
        $link->update(['password_hash' => Hash::make('link-password')]);
        $variant = $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/links/'.$link->id.'/qr-variants', ['name' => 'Cartel', 'spec' => $this->spec])->assertCreated()->json('variant');
        $gate = $this->withHeader('Accept', 'text/html')->get('https://uvh.es/r/protected?qr='.$variant['publicId'])->assertForbidden();
        $gate->assertSee('name="qr" value="'.$variant['publicId'].'"', false);
        $this->assertSame(0, DB::table('qr_daily_counts')->count());
        $csrfCookie = collect($gate->headers->getCookies())->first(fn ($cookie) => $cookie->getName() === 'uvh_csrf');
        $csrf = $csrfCookie?->getValue() ?? 'qr-csrf';
        $this->withCookie('uvh_csrf', $csrf)->withHeader('X-CSRF-Token', $csrf);
        $this->post('https://uvh.es/r/protected/unlock', ['password' => '', '_csrf' => $csrf, 'qr' => $variant['publicId']])->assertStatus(422)->assertSee($variant['publicId']);
        $wrong = $this->post('https://uvh.es/r/protected/unlock', ['password' => 'wrong', '_csrf' => $csrf, 'qr' => $variant['publicId']])->assertForbidden()->assertSee($variant['publicId']);
        $cookie = collect($wrong->headers->getCookies())->first(fn ($cookie) => $cookie->getName() === 'uvh_csrf');
        if ($cookie) {
            $csrf = $cookie->getValue();
            $this->withCookie('uvh_csrf', $csrf)->withHeader('X-CSRF-Token', $csrf);
        }
        $unlocked = $this->post('https://uvh.es/r/protected/unlock', ['password' => 'link-password', '_csrf' => $csrf, 'qr' => $variant['publicId']])->assertOk()->assertSee('/r/protected?qr='.$variant['publicId'], false);
        $unlock = collect($unlocked->headers->getCookies())->first(fn ($cookie) => $cookie->getName() === RedirectService::UNLOCK_COOKIE);
        $this->withCookie($unlock->getName(), $unlock->getValue())->get('https://uvh.es/r/protected?qr='.$variant['publicId'])->assertRedirect();
        $this->assertSame(1, (int) DB::table('qr_daily_counts')->sum('visits'));
    }

    public function test_custom_domain_foreign_variant_and_exhausted_link_do_not_cross_attribute(): void
    {
        $domain = CustomDomain::create(['workspace_id' => $this->workspace->id, 'domain' => 'qr.example.test', 'verification_token' => 'uvh-verify=fixture', 'verification_version' => 1, 'verification_scheme' => 2, 'desired_state' => 'enabled', 'ownership_status' => 'verified', 'routing_status' => 'healthy', 'tls_status' => 'ready', 'verified_at' => now(), 'ownership_verified_at' => now(), 'routing_verified_at' => now(), 'edge_eligible' => true, 'tls_ready_at' => now()]);
        DomainClaims::prove((int) $this->workspace->id, $domain->domain);
        $link = $this->link('domain-qr');
        $link->update(['domain_id' => $domain->id, 'max_clicks' => 1]);
        $other = $this->link('foreign');
        $variant = $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/links/'.$other->id.'/qr-variants', ['name' => 'Ajena', 'spec' => $this->spec])->assertCreated()->json('variant');
        $this->get('https://qr.example.test/domain-qr?qr='.$variant['publicId'])->assertRedirect('https://example.org/path?utm_source=original');
        $this->assertSame(0, DB::table('qr_daily_counts')->count());
        $this->get('https://qr.example.test/domain-qr?qr='.$variant['publicId'])->assertStatus(410);
        $this->assertSame(1, (int) $link->refresh()->click_count);
        $this->getJson('/api/v1/links/'.$other->id.'/qr-variants/comparison?from=2026-02-30&to=2026-03-02')->assertStatus(422);
    }

    public function test_comparison_keeps_one_snapshot_during_concurrent_analytics(): void
    {
        $link = $this->link('snapshot');
        $variant = $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/links/'.$link->id.'/qr-variants', ['name' => 'Snapshot', 'spec' => $this->spec])->assertCreated()->json('variant');
        $this->get('https://uvh.es/r/snapshot?qr='.$variant['publicId'])->assertRedirect();
        config(['database.connections.qr_concurrent' => config('database.connections.'.config('database.default'))]);
        $changed = false;
        DB::listen(function ($event) use (&$changed, $link, $variant): void {
            if ($changed || ! str_contains($event->sql, 'from "qr_daily_counts"')) {
                return;
            }
            $changed = true;
            $other = DB::connection('qr_concurrent');
            $other->transaction(function () use ($other, $link, $variant): void {
                $other->table('qr_daily_counts')->where('variant_id', $variant['id'])->increment('visits');
                $other->table('metric_rollups')->where('link_id', $link->id)->increment('clicks');
            });
        });
        try {
            $this->getJson('/api/v1/links/'.$link->id.'/qr-variants/comparison')->assertOk()->assertJsonPath('attributedVisits', 1)->assertJsonPath('unattributedVisits', 0);
            $this->assertTrue($changed);
            $this->assertSame(2, (int) DB::table('qr_daily_counts')->sum('visits'));
        } finally {
            DB::disconnect('qr_concurrent');
        }
    }

    public function test_account_export_contains_normalized_logos_and_snapshot_without_private_paths(): void
    {
        $file = UploadedFile::fake()->image('logo.png', 20, 10);
        $id = $this->withHeader('Idempotency-Key', (string) Str::uuid())->post('/api/v1/qr-assets', ['logo' => $file])->assertCreated()->json('asset.id');
        $this->spec['logo'] = ['kind' => 'custom', 'assetId' => $id];
        $this->createDesign();
        $stream = fopen('php://temp', 'w+b');
        AccountExportDocument::render($this->owner->id, $stream);
        rewind($stream);
        $json = stream_get_contents($stream);
        fclose($stream);
        $data = json_decode($json, true, flags: JSON_THROW_ON_ERROR);
        $this->assertCount(1, $data['qrDesigns']);
        $this->assertSame("\x89PNG\r\n\x1a\n", substr(base64_decode($data['qrLogoMetadata'][0]['contentBase64']), 0, 8));
        $this->assertArrayNotHasKey('path', $data['qrLogoMetadata'][0]);
        $this->assertStringNotContainsString('input_hash', $json);
    }
}
