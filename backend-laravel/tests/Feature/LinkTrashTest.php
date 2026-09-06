<?php

namespace Tests\Feature;

use App\Models\Link;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/** Isolated trash lifecycle contract; all destructive rows belong to *_test. */
final class LinkTrashTest extends TestCase
{
    private const PASSWORD = 'Correct horse battery staple 42!';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'link-trash-csrf')->withHeader('X-CSRF-Token', 'link-trash-csrf');
        config(['uvh.housekeeping.link_trash_days' => 30]);
    }

    public function test_trash_is_discoverable_paginated_and_exposes_server_purge_date(): void
    {
        [$owner, $workspace] = $this->workspace();
        $deletedAt = now()->subDays(4)->startOfSecond();
        $link = $this->trashed($workspace, $owner, 'recoverable', $deletedAt);
        $this->live($workspace, $owner, 'not-in-trash');

        $this->signIn($owner, $workspace);
        $response = $this->getJson('/api/v1/links/trash?page=1&perPage=20')->assertOk()
            ->assertJsonPath('total', 1)->assertJsonPath('retentionDays', 30)
            ->assertJsonPath('links.0.link.id', $link->id)->assertJsonPath('links.0.link.state', 'deleted')
            ->assertJsonPath('links.0.previousState', 'active');
        $this->assertSame($deletedAt->copy()->addDays(30)->format('Y-m-d\TH:i:s.v\Z'), $response->json('links.0.purgeAt'));
        $this->assertStringNotContainsString('not-in-trash', $response->getContent());
    }

    public function test_editor_can_restore_but_viewer_has_read_only_access(): void
    {
        [$owner, $workspace] = $this->workspace();
        $editor = User::factory()->create(['email_verified_at' => now()]);
        $viewer = User::factory()->create(['email_verified_at' => now()]);
        $workspace->memberships()->createMany([
            ['user_id' => $editor->id, 'role' => 'editor'], ['user_id' => $viewer->id, 'role' => 'viewer'],
        ]);
        $link = $this->trashed($workspace, $owner, 'restore-me', now());

        $this->signIn($viewer, $workspace);
        $this->getJson('/api/v1/links/trash')->assertOk();
        $this->postJson('/api/v1/links/'.$link->id.'/restore')->assertForbidden();
        $this->signIn($editor, $workspace);
        $this->postJson('/api/v1/links/'.$link->id.'/restore')->assertOk();
        $this->assertDatabaseHas('links', ['id' => $link->id, 'state' => 'active', 'deleted_at' => null]);
    }

    public function test_permanent_delete_requires_admin_exact_phrase_and_password(): void
    {
        [$owner, $workspace] = $this->workspace();
        $link = $this->trashed($workspace, $owner, 'irreversible', now());
        $this->signIn($owner, $workspace);
        $path = '/api/v1/links/'.$link->id.'/purge';

        $this->postJson($path, ['password' => self::PASSWORD, 'confirmation' => 'ELIMINAR wrong'])
            ->assertUnprocessable();
        $this->assertDatabaseHas('links', ['id' => $link->id]);
        $this->postJson($path, ['password' => 'wrong password', 'confirmation' => 'ELIMINAR irreversible'])
            ->assertForbidden();
        $this->assertDatabaseHas('links', ['id' => $link->id]);
        $this->postJson($path, ['password' => self::PASSWORD, 'confirmation' => 'ELIMINAR irreversible'])
            ->assertOk()->assertExactJson(['ok' => true]);
        $this->assertDatabaseMissing('links', ['id' => $link->id]);
        $this->assertDatabaseHas('audit_events', ['workspace_id' => $workspace->id, 'action' => 'link.purge', 'resource_id' => (string) $link->id]);
    }

    public function test_editor_and_foreign_admin_cannot_purge_workspace_link(): void
    {
        [$owner, $workspace] = $this->workspace();
        $editor = User::factory()->create(['email_verified_at' => now(), 'password_hash' => Hash::make(self::PASSWORD)]);
        $workspace->memberships()->create(['user_id' => $editor->id, 'role' => 'editor']);
        $link = $this->trashed($workspace, $owner, 'private-trash', now());

        $this->signIn($editor, $workspace);
        $this->postJson('/api/v1/links/'.$link->id.'/purge', ['password' => self::PASSWORD, 'confirmation' => 'ELIMINAR private-trash'])->assertForbidden();
        [, $foreignWorkspace] = $this->workspace();
        $this->signIn($owner, $workspace);
        $foreign = $this->trashed($foreignWorkspace, User::findOrFail($foreignWorkspace->owner_user_id), 'foreign-trash', now());
        $this->postJson('/api/v1/links/'.$foreign->id.'/purge', ['password' => self::PASSWORD, 'confirmation' => 'ELIMINAR foreign-trash'])->assertNotFound();
        $this->assertDatabaseHas('links', ['id' => $foreign->id]);
    }

    /** @return array{User, Workspace} */
    private function workspace(): array
    {
        $owner = User::factory()->create(['email_verified_at' => now(), 'password_hash' => Hash::make(self::PASSWORD)]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Trash', 'slug' => 'trash-'.Ids::randomToken(8)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);

        return [$owner, $workspace];
    }

    private function trashed(Workspace $workspace, User $creator, string $alias, $deletedAt): Link
    {
        return Link::create(['workspace_id' => $workspace->id, 'created_by' => $creator->id,
            'alias' => $alias, 'destination' => 'https://example.test/'.$alias,
            'state' => 'deleted', 'state_before_delete' => 'active', 'deleted_at' => $deletedAt, 'version' => 2]);
    }

    private function live(Workspace $workspace, User $creator, string $alias): Link
    {
        return Link::create(['workspace_id' => $workspace->id, 'created_by' => $creator->id,
            'alias' => $alias, 'destination' => 'https://example.test/'.$alias, 'state' => 'active']);
    }

    private function signIn(User $user, Workspace $workspace): void
    {
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $workspace->id);
    }
}
