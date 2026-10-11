<?php

namespace Tests\Feature;

use App\Models\CustomDomain;
use App\Models\Link;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\LinkService;
use App\Support\NotificationKinds;
use App\Support\NotificationPreferences;
use App\Support\OperationalNotices;
use App\Support\RedirectService;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

final class LinkWorkflowsTest extends TestCase
{
    private User $owner;

    private Workspace $workspace;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, audit_events, operational_notice_events RESTART IDENTITY CASCADE');
        config(['workflows.enabled' => true]);
        Queue::fake();
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'workflow-csrf')->withHeaders(['X-CSRF-Token' => 'workflow-csrf']);
        $this->owner = User::factory()->create(['email_verified_at' => now()]);
        $this->workspace = $this->owner->ownedWorkspaces()->create(['name' => 'Workflows', 'slug' => Ids::randomToken(12)]);
        $this->workspace->memberships()->create(['user_id' => $this->owner->id, 'role' => 'owner']);
        $this->signIn($this->owner);
    }

    private function signIn(User $user): void
    {
        $this->withCookie((string) config('uvh.session_cookie'), SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $this->workspace->id);
    }

    private function link(array $fields = []): Link
    {
        return Link::create($fields + ['workspace_id' => $this->workspace->id, 'created_by' => $this->owner->id, 'alias' => strtolower(Ids::randomAlias(8)), 'destination' => 'https://example.org/path', 'state' => 'active']);
    }

    private function page(): array
    {
        $copy = ['title' => 'Gracias por tu interés', 'message' => 'Esta promoción terminó.', 'buttonLabel' => 'Ver novedades', 'buttonUrl' => 'https://example.org/new'];

        return ['version' => 1, 'enabled' => true, 'expired' => $copy, 'exhausted' => $copy];
    }

    public function test_duplicate_keeps_settings_but_resets_statistics_and_replays_once(): void
    {
        $source = $this->link(['password_hash' => Hash::make('fixture-password'), 'click_count' => 9, 'max_clicks' => 10, 'single_use' => true, 'used_at' => now(), 'notes' => 'Campaña', 'utm_campaign' => 'Navidad', 'state' => 'paused', 'expired_page' => $this->page()]);
        $source->rules()->create(['priority' => 1, 'country' => 'es', 'destination' => 'https://example.org/es']);
        $this->withHeader('Idempotency-Key', (string) Str::uuid());
        $body = ['sourceVersion' => 1, 'passwordAction' => 'keep', 'alias' => 'new-copy'];
        $id = $this->postJson('/api/v1/links/'.$source->id.'/duplicate', $body)->assertCreated()->assertJsonPath('link.clickCount', 0)->assertJsonPath('link.usedAt', null)->assertJsonPath('link.state', 'paused')->assertJsonPath('link.passwordProtected', true)->assertJsonPath('link.expiredPage.expired.title', $this->page()['expired']['title'])->json('link.id');
        $copy = Link::findOrFail($id);
        $this->assertSame($source->password_hash, $copy->password_hash);
        $this->assertEquals($source->expired_page, $copy->expired_page);
        $this->assertSame(1, $copy->rules()->count());
        $this->assertSame(0, DB::table('qr_variants')->where('link_id', $id)->count());
        $this->postJson('/api/v1/links/'.$source->id.'/duplicate', $body)->assertCreated()->assertJsonPath('link.id', $id);
        $this->postJson('/api/v1/links/'.$source->id.'/duplicate', $body + ['notes' => 'Another'])->assertStatus(409);
        $copy->delete();
        $this->postJson('/api/v1/links/'.$source->id.'/duplicate', $body)->assertStatus(410);
    }

    public function test_duplicate_preserves_every_setting_and_excludes_personal_and_campaign_data(): void
    {
        $domain = CustomDomain::create(['workspace_id' => $this->workspace->id, 'domain' => 'links.example.org', 'verification_token' => Ids::randomToken(32), 'desired_state' => 'enabled', 'edge_eligible' => true, 'verified_at' => now(), 'ownership_status' => 'verified', 'routing_status' => 'healthy', 'tls_status' => 'ready', 'tls_ready_at' => now()]);
        DB::table('custom_domain_claims')->insert(['workspace_id' => $this->workspace->id, 'domain' => $domain->domain]);
        $collection = DB::table('collections')->insertGetId(['workspace_id' => $this->workspace->id, 'name' => 'Campañas']);
        $source = $this->link(['domain_id' => $domain->id, 'collection_id' => $collection,
            'fallback_destination' => 'https://example.org/backup', 'state' => 'archived',
            'password_hash' => Hash::make('private-password'), 'max_clicks' => 500,
            'single_use' => true, 'used_at' => now(), 'click_count' => 250,
            'scheduled_at' => now()->addDay(), 'expires_at' => now()->addWeek(),
            'notes' => 'Notas de campaña', 'expired_page' => $this->page(),
            'utm_source' => 'email', 'utm_medium' => 'qr', 'utm_campaign' => 'Navidad',
            'utm_term' => 'regalos', 'utm_content' => 'cartel']);
        $tag = DB::table('tags')->insertGetId(['workspace_id' => $this->workspace->id, 'name' => 'Navidad']);
        DB::table('link_tags')->insert(['link_id' => $source->id, 'tag_id' => $tag]);
        $rule = ['priority' => 5, 'country' => 'es', 'language' => 'es', 'device' => 'mobile',
            'os' => 'Android', 'time_from' => '09:00', 'time_to' => '18:00',
            'referrer' => 'example.org', 'campaign' => 'Navidad', 'destination' => 'https://example.org/mobile'];
        $source->rules()->create($rule);
        $this->patchJson('/api/v1/links/'.$source->id.'/favorite', ['favorite' => true])->assertOk();
        DB::table('qr_variants')->insert(['workspace_id' => $this->workspace->id, 'link_id' => $source->id,
            'created_by' => $this->owner->id, 'name' => 'Cartel', 'public_id' => bin2hex(random_bytes(16)),
            'spec' => json_encode(['version' => 1, 'foreground' => '#000000', 'background' => '#ffffff',
                'correction' => 'H', 'quietZone' => 4, 'logo' => ['kind' => 'uvh'], 'frame' => 'none', 'caption' => '']), 'request_key' => (string) Str::uuid(),
            'request_hash' => hash('sha256', 'original-campaign'), 'created_at' => now(), 'updated_at' => now()]);
        $id = $this->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/links/'.$source->id.'/duplicate', ['sourceVersion' => 1, 'alias' => 'copia-completa'])
            ->assertCreated()->assertJsonPath('link.state', 'archived')->assertJsonPath('link.tags', ['Navidad'])->json('link.id');
        $copy = Link::findOrFail($id);
        $source->refresh();
        foreach (['destination', 'fallback_destination', 'domain_id', 'collection_id', 'password_hash',
            'max_clicks', 'single_use', 'notes', 'expired_page', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as $field) {
            $this->assertSame($source->{$field}, $copy->{$field}, $field);
        }
        foreach (['scheduled_at', 'expires_at'] as $field) {
            $this->assertTrue($source->{$field}->equalTo($copy->{$field}), $field);
        }
        $this->assertSame(0, $copy->click_count);
        $this->assertNull($copy->used_at);
        $this->assertSame(1, $copy->version);
        $this->assertEquals($rule, $copy->rules()->firstOrFail()->only(array_keys($rule)));
        $this->assertDatabaseMissing('qr_variants', ['link_id' => $id]);
        $this->assertDatabaseMissing('link_favorites', ['link_id' => $id]);
    }

    public function test_duplicate_revalidates_domain_collection_and_alias_before_creating_a_copy(): void
    {
        $source = $this->link();
        $other = $this->owner->ownedWorkspaces()->create(['name' => 'Otro', 'slug' => Ids::randomToken(12)]);
        $domain = CustomDomain::create(['workspace_id' => $other->id, 'domain' => 'foreign.example.org', 'verification_token' => Ids::randomToken(32), 'desired_state' => 'enabled', 'edge_eligible' => true, 'verified_at' => now(), 'ownership_status' => 'verified', 'routing_status' => 'healthy', 'tls_status' => 'ready', 'tls_ready_at' => now()]);
        DB::table('custom_domain_claims')->insert(['workspace_id' => $other->id, 'domain' => $domain->domain]);
        $collection = DB::table('collections')->insertGetId(['workspace_id' => $other->id, 'name' => 'Ajena']);
        foreach ([[['domainId' => $domain->id], 403], [['collectionId' => $collection], 422],
            [['alias' => $source->alias], 409], [['destination' => 'javascript:alert(1)'], 422]] as [$fields, $status]) {
            $this->withHeader('Idempotency-Key', (string) Str::uuid())
                ->postJson('/api/v1/links/'.$source->id.'/duplicate', $fields + ['sourceVersion' => 1])->assertStatus($status);
            $this->assertSame(1, Link::where('workspace_id', $this->workspace->id)->count());
            $this->assertSame(0, DB::table('link_duplicate_receipts')->count());
        }
    }

    public function test_duplicate_refuses_stale_blocked_quota_and_unsafe_password_contract(): void
    {
        $source = $this->link();
        $this->withHeader('Idempotency-Key', (string) Str::uuid());
        $this->postJson('/api/v1/links/'.$source->id.'/duplicate', ['sourceVersion' => 2])->assertStatus(409);
        $this->postJson('/api/v1/links/'.$source->id.'/duplicate', ['sourceVersion' => 1, 'passwordAction' => 'keep', 'password' => 'secret'])->assertStatus(422);
        $source->update(['state' => 'blocked']);
        $this->postJson('/api/v1/links/'.$source->id.'/duplicate', ['sourceVersion' => 1])->assertForbidden();
        $source->update(['state' => 'active']);
        DB::table('quotas')->insert(['workspace_id' => $this->workspace->id, 'links_limit' => 1]);
        $this->postJson('/api/v1/links/'.$source->id.'/duplicate', ['sourceVersion' => 1])->assertStatus(429);
    }

    public function test_duplicate_password_replacement_removal_and_expired_dates_are_correct(): void
    {
        $source = $this->link(['expires_at' => now()->subDay(), 'state' => 'expired', 'password_hash' => Hash::make('old-password')]);
        foreach (['replace', 'remove'] as $action) {
            $body = ['sourceVersion' => 1, 'passwordAction' => $action];
            if ($action === 'replace') {
                $body['password'] = 'new-password';
            }
            $id = $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/links/'.$source->id.'/duplicate', $body)->assertCreated()->assertJsonPath('link.state', 'expired')->json('link.id');
            $copy = Link::findOrFail($id);
            $this->assertTrue($action === 'remove' ? $copy->password_hash === null : Hash::check('new-password', $copy->password_hash));
        }
    }

    public function test_favorites_are_personal_and_viewer_mutations_do_not_touch_link_versions(): void
    {
        $link = $this->link();
        $this->patchJson('/api/v1/links/'.$link->id.'/favorite', ['favorite' => true])->assertOk();
        $this->getJson('/api/v1/links?favorites=true')->assertOk()->assertJsonCount(1, 'links')->assertJsonPath('links.0.favorite', true);
        $viewer = User::factory()->create(['email_verified_at' => now()]);
        $this->workspace->memberships()->create(['user_id' => $viewer->id, 'role' => 'viewer']);
        $this->signIn($viewer);
        $this->getJson('/api/v1/links?favorites=true')->assertJsonCount(0, 'links');
        $this->patchJson('/api/v1/links/'.$link->id.'/favorite', ['favorite' => true])->assertOk();
        $this->assertSame(1, (int) $link->fresh()->version);
        $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/links/'.$link->id.'/duplicate', ['sourceVersion' => 1])->assertForbidden();
        $link->delete();
        $this->getJson('/api/v1/links?favorites=true')->assertJsonCount(0, 'links');
        $link->restore();
        $this->getJson('/api/v1/links?favorites=true')->assertJsonCount(1, 'links');
        $link->forceDelete();
        $this->assertSame(0, DB::table('link_favorites')->count());
    }

    public function test_saved_filters_are_private_versioned_and_detect_missing_references(): void
    {
        $tagId = DB::table('tags')->insertGetId(['workspace_id' => $this->workspace->id, 'name' => 'Navidad']);
        $spec = ['version' => 1, 'q' => '', 'state' => 'active', 'tag' => 'Navidad', 'domainId' => null, 'collectionId' => null, 'utmCampaign' => 'Navidad', 'favorites' => false, 'sort' => 'created_at_desc'];
        $id = $this->postJson('/api/v1/link-filters', ['name' => 'Activos de Navidad', 'spec' => $spec])->assertCreated()->assertJsonPath('filter.valid', true)->json('filter.id');
        $this->patchJson('/api/v1/link-filters/'.$id, ['version' => 1, 'name' => 'Nueva búsqueda', 'spec' => $spec])->assertOk()->assertJsonPath('filter.version', 2);
        $this->patchJson('/api/v1/link-filters/'.$id, ['version' => 1, 'name' => 'Stale', 'spec' => $spec])->assertStatus(409);
        DB::table('tags')->where('id', $tagId)->delete();
        $this->getJson('/api/v1/link-filters')->assertJsonPath('filters.0.valid', false)->assertJsonPath('filters.0.invalidReferences.0', 'tag');
        $this->getJson('/api/v1/links?savedFilterId='.$id)->assertStatus(422);
        $this->patchJson('/api/v1/link-filters/'.$id, ['name' => 'Reparar Navidad', 'version' => 2])->assertOk()->assertJsonPath('filter.version', 3)->assertJsonPath('filter.valid', false);
        $this->patchJson('/api/v1/link-filters/'.$id, ['name' => 'Stale', 'version' => 2])->assertStatus(409);
        $this->getJson('/api/v1/links?tag=Navidad')->assertStatus(422);
        $viewer = User::factory()->create(['email_verified_at' => now()]);
        $this->workspace->memberships()->create(['user_id' => $viewer->id, 'role' => 'viewer']);
        $this->signIn($viewer);
        $this->getJson('/api/v1/link-filters')->assertJsonCount(0, 'filters');
        $this->deleteJson('/api/v1/link-filters/'.$id, ['version' => 3])->assertNotFound();
        $spec['tag'] = '';
        $this->postJson('/api/v1/link-filters', ['name' => 'Mis enlaces', 'spec' => $spec])->assertCreated();
    }

    public function test_numeric_zero_tag_is_a_real_saved_filter_reference(): void
    {
        $tagId = DB::table('tags')->insertGetId(['workspace_id' => $this->workspace->id, 'name' => '0']);
        $spec = ['version' => 1, 'tag' => '0'];
        $id = $this->postJson('/api/v1/link-filters', ['name' => 'Etiqueta cero', 'spec' => $spec])
            ->assertCreated()->assertJsonPath('filter.valid', true)->json('filter.id');
        $this->getJson('/api/v1/link-filters')->assertOk()->assertJsonPath('filters.0.valid', true);
        DB::table('tags')->where('id', $tagId)->delete();
        $this->getJson('/api/v1/link-filters')->assertOk()->assertJsonPath('filters.0.valid', false)
            ->assertJsonPath('filters.0.invalidReferences', ['tag']);
        $this->getJson('/api/v1/links?savedFilterId='.$id)->assertStatus(422);
        $this->postJson('/api/v1/link-filters', ['name' => 'Referencia inexistente', 'spec' => $spec])->assertStatus(422);
        $this->patchJson('/api/v1/link-filters/'.$id, ['name' => 'Pendiente de reparar', 'version' => 1])
            ->assertOk()->assertJsonPath('filter.valid', false);
    }

    public function test_expired_page_is_escaped_and_does_not_count_visits_or_override_paused_links(): void
    {
        $source = $this->link(['expired_page' => $this->page(), 'expires_at' => now()->subHour(), 'state' => 'expired']);
        $outcome = RedirectService::resolve(['host' => 'uvh.es', 'alias' => $source->alias]);
        $this->assertSame('Gracias por tu interés', $outcome['page']['title']);
        $this->get('https://uvh.es/r/'.$source->alias)->assertNotFound()->assertSee('Gracias por tu interés')->assertSee('rel="noopener noreferrer nofollow"', false);
        $this->assertSame(0, (int) $source->fresh()->click_count);
        $source->update(['state' => 'paused']);
        $this->assertArrayNotHasKey('page', RedirectService::resolve(['host' => 'uvh.es', 'alias' => $source->alias]));
        $page = $this->page();
        $page['expired']['title'] = '<script>alert(1)</script>';
        $this->assertFalse(LinkService::validate(['destination' => 'https://example.org', 'expired_page' => $page])['ok']);
        $page = $this->page();
        $page['exhausted']['buttonUrl'] = 'javascript:alert(1)';
        $this->assertFalse(LinkService::validate(['destination' => 'https://example.org', 'expired_page' => $page])['ok']);
    }

    public function test_foreign_workspace_resources_and_personal_preferences_are_isolated(): void
    {
        $other = $this->owner->ownedWorkspaces()->create(['name' => 'Other', 'slug' => Ids::randomToken(12)]);
        $other->memberships()->create(['user_id' => $this->owner->id, 'role' => 'owner']);
        $foreign = $this->link(['workspace_id' => $other->id]);
        $this->patchJson('/api/v1/links/'.$foreign->id.'/favorite', ['favorite' => true])->assertNotFound();
        $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/links/'.$foreign->id.'/duplicate', ['sourceVersion' => 1])->assertNotFound();
        $this->getJson('/api/v1/links?domainId=999999')->assertStatus(422);
        $this->getJson('/api/v1/links?collectionId=999999')->assertStatus(422);
        $this->postJson('/api/v1/link-filters', ['name' => 'Broken', 'spec' => ['version' => 1, 'collectionId' => 999999]])->assertStatus(422);
        $this->assertSame(0, DB::table('link_favorites')->count());
    }

    public function test_saved_filter_quota_and_strict_contracts_are_enforced(): void
    {
        config(['workflows.max_saved_filters' => 1]);
        $spec = ['version' => 1, 'favorites' => true];
        $this->postJson('/api/v1/link-filters', ['name' => 'Starred', 'spec' => $spec])->assertCreated();
        $this->postJson('/api/v1/link-filters', ['name' => 'Another', 'spec' => $spec])->assertStatus(429);
        $this->postJson('/api/v1/link-filters', ['name' => str_repeat('x', 81), 'spec' => $spec])->assertStatus(422);
        $this->postJson('/api/v1/link-filters', ['name' => 'Unsafe', 'spec' => $spec + ['sql' => 'DROP TABLE links']])->assertStatus(422);
        $link = $this->link();
        $this->patchJson('/api/v1/links/'.$link->id.'/favorite', ['favorite' => 'true'])->assertStatus(422);
        $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/links/'.$link->id.'/duplicate', ['sourceVersion' => 1, 'password_hash' => 'not-a-hash'])->assertStatus(422);
    }

    public function test_exhausted_page_preserves_password_admission_and_does_not_consume_more_clicks(): void
    {
        $link = $this->link(['max_clicks' => 1, 'click_count' => 1, 'expired_page' => $this->page(), 'password_hash' => Hash::make('gate')]);
        $this->assertSame('password_required', RedirectService::resolve(['host' => 'uvh.es', 'alias' => $link->alias])['kind']);
        $link->update(['password_hash' => null]);
        $outcome = RedirectService::resolve(['host' => 'uvh.es', 'alias' => $link->alias]);
        $this->assertSame('gone', $outcome['kind']);
        $this->assertSame('Gracias por tu interés', $outcome['page']['title']);
        $this->get('https://uvh.es/r/'.$link->alias)->assertStatus(410)->assertSee('Gracias por tu interés');
        $this->assertSame(1, (int) $link->fresh()->click_count);
        $link->update(['state' => 'blocked']);
        $this->assertArrayNotHasKey('page', RedirectService::resolve(['host' => 'uvh.es', 'alias' => $link->alias]));
    }

    public function test_feature_switch_suppresses_new_controls_and_custom_public_pages(): void
    {
        $link = $this->link(['state' => 'expired', 'expired_page' => $this->page()]);
        config(['workflows.enabled' => false]);
        $this->patchJson('/api/v1/links/'.$link->id.'/favorite', ['favorite' => true])->assertNotFound();
        $this->getJson('/api/v1/link-filters')->assertNotFound();
        $this->withHeader('Idempotency-Key', (string) Str::uuid())->postJson('/api/v1/links/'.$link->id.'/duplicate', ['sourceVersion' => 1])->assertNotFound();
        $this->assertArrayNotHasKey('page', RedirectService::resolve(['host' => 'uvh.es', 'alias' => $link->alias]));
    }

    public function test_notices_include_member_creator_and_skip_exhausted_links(): void
    {
        $creator = User::factory()->create(['email_verified_at' => now()]);
        $this->workspace->memberships()->create(['user_id' => $creator->id, 'role' => 'editor']);
        foreach ([$this->owner, $creator] as $user) {
            NotificationPreferences::update($user->id, [NotificationKinds::LINK_EXPIRING => 'in_app_only', NotificationKinds::LINK_LIMIT_APPROACHING => 'in_app_only']);
        }
        $link = $this->link(['created_by' => $creator->id, 'expires_at' => now()->addHour(), 'max_clicks' => 10, 'click_count' => 9]);
        $this->link(['created_by' => $creator->id, 'expires_at' => now()->addHour(), 'max_clicks' => 10, 'click_count' => 10]);
        OperationalNotices::sweep();
        OperationalNotices::sweep();
        $this->assertSame(4, DB::table('notifications')->count());
        $this->assertSame(2, DB::table('operational_notice_events')->count());
        $this->assertSame('/app/links/'.$link->id.'?workspaceId='.$this->workspace->id, DB::table('notifications')->value('route'));
        $input = ['destination' => $link->destination, 'max_clicks' => 20, 'expires_at' => $link->expires_at->format('Y-m-d\TH:i:s.uP')];
        LinkService::update($link->id, $this->workspace->id, $this->owner->id, $input, 1);
        $link->refresh();
        $input['max_clicks'] = 10;
        LinkService::update($link->id, $this->workspace->id, $this->owner->id, $input, 2);
        OperationalNotices::sweep();
        $this->assertSame(6, DB::table('notifications')->count());
        $this->workspace->memberships()->where('user_id', $creator->id)->delete();
        $link->update(['limit_notice_generation' => 4]);
        OperationalNotices::sweep();
        $this->assertSame(7, DB::table('notifications')->count());
    }
}
