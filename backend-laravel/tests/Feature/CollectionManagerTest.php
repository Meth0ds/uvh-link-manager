<?php

namespace Tests\Feature;

use App\Models\Link;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Database\Events\QueryExecuted;
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
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, quotas, links, collections, link_templates, audit_events, operational_metrics RESTART IDENTITY CASCADE');
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

    public function test_deleting_a_collection_drops_it_from_saved_templates(): void
    {
        [$owner, $workspace] = $this->workspace();
        $id = DB::table('collections')->insertGetId(['workspace_id' => $workspace->id, 'name' => 'Campaña']);
        $other = DB::table('collections')->insertGetId(['workspace_id' => $workspace->id, 'name' => 'Otra']);
        $linkId = $this->link($owner, $workspace, $id);
        $pointing = DB::table('link_templates')->insertGetId([
            'workspace_id' => $workspace->id, 'created_by' => $owner->id, 'name' => 'Con colección',
            'payload' => json_encode(['destination' => 'https://example.org/x', 'collection_id' => $id]),
        ]);
        $untouched = DB::table('link_templates')->insertGetId([
            'workspace_id' => $workspace->id, 'created_by' => $owner->id, 'name' => 'De otra',
            'payload' => json_encode(['destination' => 'https://example.org/y', 'collection_id' => $other]),
        ]);
        $this->signIn($owner, $workspace);

        $this->deleteJson('/api/v1/collections/'.$id)->assertOk()->assertJson(['moved' => 1]);

        // La plantilla sigue existiendo pero ya no apunta a un id muerto; la
        // que apuntaba a otra colección no se toca.
        $payload = json_decode((string) DB::table('link_templates')->where('id', $pointing)->value('payload'), true);
        $this->assertIsArray($payload);
        $this->assertArrayNotHasKey('collection_id', $payload);
        $otherPayload = json_decode((string) DB::table('link_templates')->where('id', $untouched)->value('payload'), true);
        $this->assertSame($other, $otherPayload['collection_id'] ?? null);
        $this->assertSame(2, DB::table('link_templates')->count());
        $this->assertNull(DB::table('links')->where('id', $linkId)->value('collection_id'));
    }

    public function test_a_create_that_loses_the_name_race_reports_a_conflict(): void
    {
        [$owner, $workspace] = $this->workspace();
        $this->signIn($owner, $workspace);

        // Otro hilo crea «Campaña» entre la comprobación y la escritura: el
        // índice único decide y el resultado es un conflicto, no un error 500.
        $race = true;
        DB::listen(static function (QueryExecuted $event) use (&$race, $workspace): void {
            if (! $race || ! str_starts_with(strtolower($event->sql), 'select exists')
                || ! str_contains($event->sql, '"collections"')) {
                return;
            }
            $race = false;
            DB::table('collections')->insert(['workspace_id' => $workspace->id, 'name' => 'Campaña']);
        });

        $this->postJson('/api/v1/collections', ['name' => 'Campaña'])->assertStatus(409);
        $this->assertSame(1, DB::table('collections')->where('workspace_id', $workspace->id)->count());
    }

    public function test_a_rename_that_loses_the_name_race_reports_a_conflict(): void
    {
        [$owner, $workspace] = $this->workspace();
        $id = DB::table('collections')->insertGetId(['workspace_id' => $workspace->id, 'name' => 'Mía']);
        $this->signIn($owner, $workspace);

        $race = true;
        DB::listen(static function (QueryExecuted $event) use (&$race, $workspace): void {
            if (! $race || ! str_starts_with(strtolower($event->sql), 'select exists')
                || ! str_contains($event->sql, '"collections"')) {
                return;
            }
            $race = false;
            DB::table('collections')->insert(['workspace_id' => $workspace->id, 'name' => 'Tomada']);
        });

        $this->patchJson('/api/v1/collections/'.$id, ['name' => 'Tomada'])->assertStatus(409);
        $this->assertSame('Mía', (string) DB::table('collections')->where('id', $id)->value('name'));
        $this->assertSame('Tomada', (string) DB::table('collections')->where('id', '!=', $id)->value('name'));
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
