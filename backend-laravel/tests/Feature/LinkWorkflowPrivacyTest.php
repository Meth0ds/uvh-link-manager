<?php

namespace Tests\Feature;

use App\Models\AccountDeletionRequest;
use App\Models\Link;
use App\Models\User;
use App\Support\AccountExportDocument;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

final class LinkWorkflowPrivacyTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox, mail_outbox, notifications RESTART IDENTITY CASCADE');
        config(['workflows.enabled' => true]);
        Queue::fake();
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'privacy-workflows')->withHeader('X-CSRF-Token', 'privacy-workflows');
    }

    private function fixture(): array
    {
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $member = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Shared', 'slug' => Ids::randomToken(12)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $workspace->memberships()->create(['user_id' => $member->id, 'role' => 'viewer']);
        $link = Link::create(['workspace_id' => $workspace->id, 'created_by' => $member->id, 'alias' => 'privacy-fixture', 'destination' => 'https://example.org/path', 'state' => 'active']);
        foreach ([$owner, $member] as $user) {
            DB::table('link_favorites')->insert(['user_id' => $user->id, 'workspace_id' => $workspace->id, 'link_id' => $link->id, 'created_at' => now()]);
            DB::table('saved_link_filters')->insert(['user_id' => $user->id, 'workspace_id' => $workspace->id, 'name' => 'Personal '.$user->id, 'spec' => json_encode(['version' => 1, 'favorites' => true]), 'version' => 1, 'created_at' => now(), 'updated_at' => now()]);
            DB::table('destination_inspections')->insert(['id' => (string) Str::uuid(), 'user_id' => $user->id, 'workspace_id' => $workspace->id, 'link_id' => null, 'security_version' => 1, 'session_id' => str_repeat('a', 64), 'mode' => 'preview', 'fingerprint' => hash('sha256', (string) $user->id), 'url_ciphertext' => Crypt::encryptString('https://example.org/?secret=private-draft-'.$user->id), 'status' => 'pending', 'expires_at' => now()->addMinutes(10), 'created_at' => now(), 'updated_at' => now()]);
        }

        return compact('owner', 'member', 'workspace', 'link');
    }

    public function test_export_contains_only_personal_preferences_without_transient_urls(): void
    {
        $f = $this->fixture();
        $out = fopen('php://temp', 'w+b');
        $this->assertIsResource($out);
        AccountExportDocument::render($f['member']->id, $out);
        rewind($out);
        $json = stream_get_contents($out);
        fclose($out);
        $document = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        $this->assertCount(1, $document['linkFavorites']);
        $this->assertSame($f['link']->id, $document['linkFavorites'][0]['link_id']);
        $this->assertSame($f['workspace']->id, $document['linkFavorites'][0]['workspace_id']);
        $this->assertCount(1, $document['savedLinkFilters']);
        $this->assertSame('Personal '.$f['member']->id, $document['savedLinkFilters'][0]['name']);
        $this->assertStringNotContainsString('private-draft', $json);
        $this->assertArrayNotHasKey('destinationInspections', $document);
    }

    public function test_account_suspension_removes_drafts_and_final_erasure_removes_preferences(): void
    {
        $f = $this->fixture();
        $user = $f['member'];
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), 1, true));
        $token = Ids::randomToken(32);
        $deletion = AccountDeletionRequest::create(['user_id' => $user->id, 'security_version' => 1, 'status' => 'requested', 'confirmation_token_hash' => Ids::sha256Hex($token), 'confirmation_expires_at' => now()->addHour()]);
        $this->postJson('/api/v1/auth/account-deletion/confirm', ['token' => $token])->assertOk();
        $this->assertDatabaseMissing('destination_inspections', ['user_id' => $user->id]);
        $this->assertDatabaseHas('destination_inspections', ['user_id' => $f['owner']->id]);
        $this->assertDatabaseHas('link_favorites', ['user_id' => $user->id]);
        $deletion->refresh()->update(['execute_after' => now()->subSecond()]);
        DB::table('mail_outbox')->where('kind', 'account_deletion_scheduled')->where('resource_id', (string) $deletion->id)->update(['status' => 'sent', 'sent_at' => now()]);
        Cache::forget('uvh:housekeeping:last_heavy');
        $this->assertSame(0, Artisan::call('uvh:housekeeping'), Artisan::output());
        $this->assertSame('executed', $deletion->refresh()->status);
        $this->assertDatabaseMissing('link_favorites', ['user_id' => $user->id]);
        $this->assertDatabaseMissing('saved_link_filters', ['user_id' => $user->id]);
        $this->assertDatabaseHas('link_favorites', ['user_id' => $f['owner']->id]);
        $this->assertDatabaseHas('saved_link_filters', ['user_id' => $f['owner']->id]);
    }

    public function test_deleting_workspace_cascades_all_private_preferences_and_inspections(): void
    {
        $f = $this->fixture();
        $f['workspace']->delete();
        foreach (['link_favorites', 'saved_link_filters', 'destination_inspections'] as $table) {
            $this->assertDatabaseMissing($table, ['workspace_id' => $f['workspace']->id]);
        }
    }

    public function test_public_page_keeps_multiline_text_and_normalizes_empty_optional_button(): void
    {
        $f = $this->fixture();
        $user = $f['owner'];
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), 1, true))->withHeader('X-Workspace-Id', (string) $f['workspace']->id);
        $copy = ['title' => 'Hasta pronto', 'message' => "Volvemos pronto.\nGracias por tu interés.", 'buttonLabel' => '   ', 'buttonUrl' => null];
        $this->postJson('/api/v1/links', ['destination' => 'https://example.org/new', 'expiredPage' => ['version' => 1, 'enabled' => true, 'expired' => $copy, 'exhausted' => $copy]])
            ->assertCreated()->assertJsonPath('link.expiredPage.expired.buttonLabel', '')
            ->assertJsonPath('link.expiredPage.exhausted.buttonUrl', null)->assertJsonPath('link.expiredPage.expired.message', $copy['message']);
    }

    public function test_partial_filter_spec_is_returned_as_a_complete_versioned_contract(): void
    {
        $f = $this->fixture();
        $user = $f['member'];
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), 1, true))->withHeader('X-Workspace-Id', (string) $f['workspace']->id);
        $this->postJson('/api/v1/link-filters', ['name' => 'Important', 'spec' => ['version' => 1, 'favorites' => true]])
            ->assertCreated()->assertJsonPath('filter.spec.q', '')->assertJsonPath('filter.spec.domainId', null)
            ->assertJsonPath('filter.spec.sort', 'created_at_desc')->assertJsonPath('filter.spec.favorites', true);
        $this->postJson('/api/v1/link-filters', ['name' => 'Normalized', 'spec' => ['version' => 1, 'q' => null, 'state' => null, 'tag' => null, 'utmCampaign' => null]])
            ->assertCreated()->assertJsonPath('filter.spec.q', '')->assertJsonPath('filter.spec.state', '')
            ->assertJsonPath('filter.spec.tag', '')->assertJsonPath('filter.spec.utmCampaign', '');
    }
}
