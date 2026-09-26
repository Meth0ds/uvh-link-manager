<?php

namespace Tests\Feature;

use App\Models\Link;
use App\Models\Tag;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Gestor de etiquetas (F7): listarlas con su uso, renombrarlas y fusionarlas
 * sin perder agrupaciones. Prepared contracts: run only with the *_test DB
 * guard.
 */
final class TagManagerTest extends TestCase
{
    private const CSRF = 'tag-csrf';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, quotas, links, tags, link_tags, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', self::CSRF)->withHeaders(['X-CSRF-Token' => self::CSRF]);
    }

    public function test_the_list_counts_only_live_links(): void
    {
        [$owner, $workspace] = $this->workspace();
        [$live] = $this->taggedLinks($owner, $workspace, 'prensa');
        $this->signIn($owner, $workspace);

        $response = $this->getJson('/api/v1/tags');
        $response->assertOk();
        $tags = collect($response->json('tags'));
        $prensa = $tags->firstWhere('name', 'prensa');
        $this->assertNotNull($prensa);
        // El enlace borrado no cuenta como uso vivo, pero la etiqueta existe.
        $this->assertSame(1, $prensa['links']);
    }

    public function test_the_usage_list_counts_every_tag_in_one_grouped_query(): void
    {
        [$owner, $workspace] = $this->workspace();
        [$live] = $this->taggedLinks($owner, $workspace, 'prensa');
        $marketing = $this->taggedLinks($owner, $workspace, 'marketing');
        // El enlace vivo de «prensa» también lleva «marketing»: cada adhesión
        // viva cuenta para su etiqueta y las borradas no cuentan para ninguna.
        DB::table('link_tags')->insert(['link_id' => $live['linkId'], 'tag_id' => $marketing[0]['tagId']]);
        $this->signIn($owner, $workspace);

        $linkTagQueries = 0;
        DB::listen(static function (QueryExecuted $event) use (&$linkTagQueries): void {
            if (str_contains($event->sql, '"link_tags"')) {
                $linkTagQueries++;
            }
        });

        $response = $this->getJson('/api/v1/tags');
        $response->assertOk();
        // El uso se cuenta con una consulta agrupada, no una por etiqueta: la
        // latencia del listado no puede crecer con su longitud.
        $this->assertSame(1, $linkTagQueries, 'the usage must be counted in one grouped query');

        $usage = collect($response->json('tags'))->pluck('links', 'name');
        $this->assertSame(1, $usage['prensa']);
        $this->assertSame(2, $usage['marketing']);
    }

    public function test_a_rename_that_loses_the_name_race_reports_a_conflict(): void
    {
        [$owner, $workspace] = $this->workspace();
        [$live] = $this->taggedLinks($owner, $workspace, 'prensa');
        $this->signIn($owner, $workspace);

        // Otro hilo toma «recién tomado» en el hueco entre la comprobación de
        // nombre y la escritura: el índice único es el que decide y el
        // resultado es un conflicto, no un error 500.
        $race = true;
        DB::listen(static function (QueryExecuted $event) use (&$race, $workspace): void {
            if (! $race || ! str_starts_with(strtolower($event->sql), 'select exists')
                || ! str_contains($event->sql, '"tags"')) {
                return;
            }
            $race = false;
            Tag::create(['workspace_id' => $workspace->id, 'name' => 'recién tomado']);
        });

        $this->postJson('/api/v1/tags/'.$live['tagId'].'/rename', ['name' => 'recién tomado'])
            ->assertStatus(409);
        $this->assertSame('prensa', (string) Tag::where('id', $live['tagId'])->value('name'));
        $this->assertSame('recién tomado', (string) Tag::where('id', '!=', $live['tagId'])->value('name'));
    }

    public function test_a_merge_that_finds_a_source_gone_under_lock_applies_nothing(): void
    {
        [$owner, $workspace] = $this->workspace();
        $target = $this->taggedLinks($owner, $workspace, 'destino');
        $gone = $this->taggedLinks($owner, $workspace, 'fundida');
        $kept = $this->taggedLinks($owner, $workspace, 'intacta');
        $this->signIn($owner, $workspace);

        // Otra fusión gana la carrera justo después de la validación: funde
        // «fundida» dentro de «intacta» y la borra. Esta petición ya había
        // validado; al llegar a los candados debe abortar entera. Sin la
        // revalidación, movería las adhesiones de «intacta» al destino y
        // borraría la etiqueta que la fusión temprana acaba de respetar.
        $race = true;
        DB::listen(static function (QueryExecuted $event) use (&$race, $gone, $kept): void {
            if (! $race || ! str_starts_with(strtolower($event->sql), 'select count(*)')
                || ! str_contains($event->sql, 'from "tags"')) {
                return;
            }
            $race = false;
            DB::table('link_tags')->where('tag_id', $gone[0]['tagId'])->update(['tag_id' => $kept[0]['tagId']]);
            Tag::where('id', $gone[0]['tagId'])->delete();
        });

        $this->postJson('/api/v1/tags/merge', [
            'sourceIds' => [$gone[0]['tagId'], $kept[0]['tagId']],
            'targetId' => $target[0]['tagId'],
        ])->assertStatus(404);

        // Nada se movió: el destino conserva sólo las suyas y las cuatro
        // adhesiones que la fusión temprana dejó en «intacta» siguen allí.
        $this->assertSame(2, DB::table('link_tags')->where('tag_id', $target[0]['tagId'])->count());
        $this->assertSame(4, DB::table('link_tags')->where('tag_id', $kept[0]['tagId'])->count());
        $this->assertNotNull(Tag::find($kept[0]['tagId']));
    }

    public function test_a_rename_moves_the_name_everywhere_and_refuses_a_taken_one(): void
    {
        [$owner, $workspace] = $this->workspace();
        [$live] = $this->taggedLinks($owner, $workspace, 'prensa');
        $taken = Tag::create(['workspace_id' => $workspace->id, 'name' => 'marketing']);
        $this->signIn($owner, $workspace);

        $renamed = $this->postJson('/api/v1/tags/'.$live['tagId'].'/rename', ['name' => 'Prensa 2026']);
        $renamed->assertOk()->assertJson(['ok' => true, 'name' => 'Prensa 2026']);
        $this->assertSame('Prensa 2026', (string) Tag::where('id', $live['tagId'])->value('name'));

        // «marketing» ya existe: sin distinguir mayúsculas no puede haber dos
        // grupos que la interfaz mostraría como uno.
        $this->postJson('/api/v1/tags/'.$live['tagId'].'/rename', ['name' => 'MARKETING'])
            ->assertStatus(409);
        $this->postJson('/api/v1/tags/'.$taken->id.'/rename', ['name' => ''])
            ->assertStatus(422);
    }

    public function test_a_merge_moves_adhesions_and_removes_the_sources(): void
    {
        [$owner, $workspace] = $this->workspace();
        $source = $this->taggedLinks($owner, $workspace, 'vieja');
        $target = $this->taggedLinks($owner, $workspace, 'nueva');
        // Un enlace con ambas etiquetas no debe acabar con adhesión duplicada.
        DB::table('link_tags')->insert(['link_id' => $source[0]['linkId'], 'tag_id' => $target[0]['tagId']]);
        $this->signIn($owner, $workspace);

        $response = $this->postJson('/api/v1/tags/merge', [
            'sourceIds' => [$source[0]['tagId']],
            'targetId' => $target[0]['tagId'],
        ]);
        $response->assertOk()->assertJson(['ok' => true, 'id' => $target[0]['tagId']]);

        $this->assertNull(Tag::find($source[0]['tagId']));
        // Los cuatro enlaces (dos vivos y dos borrados) quedan bajo la
        // etiqueta destino, cada uno una vez: el que ya tenía ambas etiquetas
        // no acumula una adhesión duplicada.
        $this->assertSame(4, DB::table('link_tags')->where('tag_id', $target[0]['tagId'])->count());
        $this->assertSame(1, DB::table('link_tags')->where('tag_id', $target[0]['tagId'])->where('link_id', $source[0]['linkId'])->count());
        $this->assertSame(4, DB::table('link_tags')->count());
    }

    public function test_tags_never_cross_workspaces(): void
    {
        [$owner, $workspace] = $this->workspace();
        [$live] = $this->taggedLinks($owner, $workspace, 'propia');
        [$foreign] = $this->taggedLinks($owner, $workspace, 'ajena', otherWorkspace: true);
        $this->signIn($owner, $workspace);

        $this->postJson('/api/v1/tags/'.$foreign['tagId'].'/rename', ['name' => 'renombrada'])
            ->assertStatus(404);
        $this->postJson('/api/v1/tags/merge', ['sourceIds' => [$foreign['tagId']], 'targetId' => $live['tagId']])
            ->assertStatus(404);
    }

    /** @return array{0: User, 1: Workspace} */
    private function workspace(): array
    {
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Etiquetas', 'slug' => 'etiquetas-'.Ids::randomToken(8)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);

        return [$owner, $workspace];
    }

    /**
     * Crea una etiqueta con dos enlaces (uno vivo y uno borrado) y devuelve
     * sus ids.
     *
     * @return array{0: array{tagId: int, linkId: int}, 1: array{tagId: int, linkId: int}}
     */
    private function taggedLinks(User $owner, Workspace $workspace, string $name, bool $otherWorkspace = false): array
    {
        $workspaceId = $workspace->id;
        if ($otherWorkspace) {
            $foreign = $owner->ownedWorkspaces()->create(['name' => 'Otra', 'slug' => 'otra-'.Ids::randomToken(8)]);
            $foreign->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
            $workspaceId = $foreign->id;
        }
        $tag = Tag::create(['workspace_id' => $workspaceId, 'name' => $name]);
        $make = function (string $alias, bool $trashed) use ($owner, $workspaceId, $tag): array {
            $linkId = Link::insertGetId([
                'workspace_id' => $workspaceId, 'created_by' => $owner->id,
                'alias' => $alias.'-'.Ids::randomToken(4), 'destination' => 'https://example.org/'.$alias,
                'state' => $trashed ? 'deleted' : 'active',
                'deleted_at' => $trashed ? now() : null,
                'state_before_delete' => $trashed ? 'active' : null,
                'version' => 1, 'created_at' => now(), 'updated_at' => now(),
            ]);
            DB::table('link_tags')->insert(['link_id' => $linkId, 'tag_id' => $tag->id]);

            return ['tagId' => (int) $tag->id, 'linkId' => $linkId];
        };

        return [$make('vivo', false), $make('borrado', true)];
    }

    private function signIn(User $user, Workspace $workspace): void
    {
        $this->withCookie((string) config('uvh.session_cookie'), SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $workspace->id);
    }
}
