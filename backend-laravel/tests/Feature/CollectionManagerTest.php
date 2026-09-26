<?php

namespace Tests\Feature;

use App\Models\Link;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Colecciones de un nivel (F7): agrupar sin anidamiento, nombres únicos sin
 * distinguir mayúsculas, y un borrado que nunca borra enlaces —sólo los deja
 * sin agrupar—. Prepared contracts: run only with the *_test DB guard.
 */
final class CollectionManagerTest extends TestCase
{
    private const CSRF = 'collection-csrf';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, quotas, links, collections, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', self::CSRF)->withHeaders(['X-CSRF-Token' => self::CSRF]);
    }

    public function test_collections_round_trip_with_their_live_link_counts(): void
    {
        [$owner, $workspace] = $this->workspace();
        $this->signIn($owner, $workspace);

        $created = $this->postJson('/api/v1/collections', ['name' => 'Campaña navidad']);
        $created->assertStatus(201)->assertJson(['collection' => ['name' => 'Campaña navidad', 'links' => 0]]);
        $id = $created->json('collection.id');

        $linkId = $this->link($owner, $workspace, $id);
        $list = $this->getJson('/api/v1/collections');
        $list->assertOk();
        $this->assertSame([['id' => $id, 'name' => 'Campaña navidad', 'links' => 1]], $list->json('collections'));

        $this->patchJson('/api/v1/collections/'.$id, ['name' => 'Navidad'])->assertOk();
        $this->assertSame('Navidad', (string) DB::table('collections')->where('id', $id)->value('name'));

        // Borrar la colección deja el enlace vivo y sin agrupar.
        $deleted = $this->deleteJson('/api/v1/collections/'.$id);
        $deleted->assertOk()->assertJson(['ok' => true, 'moved' => 1]);
        $this->assertNull(DB::table('links')->where('id', $linkId)->value('collection_id'));
        $this->assertSame('active', (string) DB::table('links')->where('id', $linkId)->value('state'));
    }

    public function test_names_are_unique_per_workspace_without_regarding_case(): void
    {
        [$owner, $workspace] = $this->workspace();
        $this->signIn($owner, $workspace);

        $this->postJson('/api/v1/collections', ['name' => 'Marketing'])->assertStatus(201);
        $this->postJson('/api/v1/collections', ['name' => 'MARKETING'])->assertStatus(409);
        $this->postJson('/api/v1/collections', ['name' => '  '])->assertStatus(422);
        $this->postJson('/api/v1/collections', ['name' => str_repeat('x', 61)])->assertStatus(422);
    }

    public function test_a_link_can_join_and_leave_a_collection_through_its_edit_contract(): void
    {
        [$owner, $workspace] = $this->workspace();
        $id = DB::table('collections')->insertGetId(['workspace_id' => $workspace->id, 'name' => 'Campaña']);
        $this->signIn($owner, $workspace);

        $created = $this->postJson('/api/v1/links', [
            'destination' => 'https://example.org/coleccionable',
            'alias' => 'coleccionable',
            'collectionId' => $id,
        ]);
        $created->assertStatus(201)->assertJson(['link' => ['collectionId' => $id, 'collection' => 'Campaña']]);
        $linkId = $created->json('link.id');
        $version = $created->json('link.version');

        // PATCH es PATCH: collectionId explícito a null desagrupa y una
        // colección ajena se rechaza en vez de colgar el enlace de un grupo
        // que el workspace ni siquiera puede ver.
        $this->patchJson('/api/v1/links/'.$linkId, ['version' => $version, 'collectionId' => null])
            ->assertOk()->assertJson(['link' => ['collectionId' => null, 'collection' => null]]);
        $this->assertNull(DB::table('links')->where('id', $linkId)->value('collection_id'));
        $this->patchJson('/api/v1/links/'.$linkId, ['version' => $version + 1, 'collectionId' => 999999])
            ->assertStatus(422);
    }

    private function workspace(): array
    {
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Colecciones', 'slug' => 'colecciones-'.Ids::randomToken(8)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);

        return [$owner, $workspace];
    }

    private function link(User $owner, Workspace $workspace, int $collectionId): int
    {
        return Link::insertGetId([
            'workspace_id' => $workspace->id, 'created_by' => $owner->id, 'collection_id' => $collectionId,
            'alias' => 'navidad-'.Ids::randomToken(4), 'destination' => 'https://example.org/navidad',
            'state' => 'active', 'version' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function signIn(User $user, Workspace $workspace): void
    {
        $this->withCookie((string) config('uvh.session_cookie'), SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $workspace->id);
    }
}
