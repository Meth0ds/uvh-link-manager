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
 * Acciones masivas con `Idempotency-Key` (F7): una repetición exacta se aplica
 * una sola vez y recibe la respuesta original; la acción es atómica sobre la
 * selección entera. Prepared contracts: run only with the *_test DB guard.
 */
final class LinkBulkIdempotencyTest extends TestCase
{
    private const CSRF = 'bulk-csrf';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, quotas, links, tags, link_tags, idempotency_keys, collections, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', self::CSRF)->withHeaders(['X-CSRF-Token' => self::CSRF]);
    }

    public function test_a_repeated_request_is_applied_once_and_replays_the_original_response(): void
    {
        [$owner, $workspace] = $this->workspace();
        $ids = [$this->link($owner, $workspace, 'uno'), $this->link($owner, $workspace, 'dos')];
        $this->signIn($owner, $workspace);
        $body = ['action' => 'pause', 'linkIds' => $ids];

        $first = $this->postJson('/api/v1/links/bulk', $body, $this->headers('clave-repetida-1'));
        $first->assertOk()->assertJson(['ok' => true, 'action' => 'pause', 'applied' => 2]);

        $replay = $this->postJson('/api/v1/links/bulk', $body, $this->headers('clave-repetida-1'));
        $replay->assertOk()->assertExactJson($first->json());
        $replay->assertHeader('Idempotent-Replay', 'true');

        // El efecto se aplicó una vez: los enlaces siguen en su estado y sólo
        // hay una reserva de clave.
        $this->assertSame(['paused', 'paused'], Link::whereIn('id', $ids)->orderBy('id')->pluck('state')->all());
        $this->assertSame(1, DB::table('idempotency_keys')->where('key', 'clave-repetida-1')->count());
    }

    public function test_the_key_is_bound_to_one_request_shape_and_never_replays_another(): void
    {
        [$owner, $workspace] = $this->workspace();
        $ids = [$this->link($owner, $workspace, 'uno')];
        $this->signIn($owner, $workspace);

        $this->postJson('/api/v1/links/bulk', ['action' => 'pause', 'linkIds' => $ids], $this->headers('clave-ligada-1'))->assertOk();

        // Misma clave, otro cuerpo: jamás se devuelve una respuesta calculada
        // sobre otros datos.
        $this->postJson('/api/v1/links/bulk', ['action' => 'archive', 'linkIds' => $ids], $this->headers('clave-ligada-1'))
            ->assertStatus(409);

        // Sin clave válida no hay operación masiva que proteger.
        $this->postJson('/api/v1/links/bulk', ['action' => 'pause', 'linkIds' => $ids])
            ->assertStatus(422);
        $this->postJson('/api/v1/links/bulk', ['action' => 'pause', 'linkIds' => $ids], $this->headers('x'))
            ->assertStatus(422);
    }

    public function test_an_in_flight_key_rejects_concurrent_duplicates_and_a_failure_frees_it(): void
    {
        [$owner, $workspace] = $this->workspace();
        $good = $this->link($owner, $workspace, 'bueno');
        $foreign = $this->link($owner, $workspace, 'ajeno', otherWorkspace: true);
        $this->signIn($owner, $workspace);

        // Reserva en curso (respuesta aún sin sellar): la repetición espera.
        DB::table('idempotency_keys')->insert([
            'user_id' => $owner->id, 'scope' => 'links.bulk', 'key' => 'clave-vuelo-1',
            'request_hash' => hash('sha256', json_encode(['action' => 'pause', 'linkIds' => [$good]])),
            'expires_at' => now()->addDay(), 'created_at' => now(),
        ]);
        $this->postJson('/api/v1/links/bulk', ['action' => 'pause', 'linkIds' => [$good]], $this->headers('clave-vuelo-1'))
            ->assertStatus(409);

        DB::table('idempotency_keys')->where('key', 'clave-vuelo-1')->delete();

        // Un fallo libera la clave: nada quedó aplicado y la misma clave vuelve
        // a estar disponible para reintentar.
        $this->postJson('/api/v1/links/bulk', ['action' => 'pause', 'linkIds' => [$good, $foreign]], $this->headers('clave-vuelo-1'))
            ->assertStatus(404);
        $this->assertSame('active', (string) Link::where('id', $good)->value('state'));
        $this->assertSame(0, DB::table('idempotency_keys')->where('key', 'clave-vuelo-1')->count());

        $this->postJson('/api/v1/links/bulk', ['action' => 'pause', 'linkIds' => [$good, $foreign]], $this->headers('clave-vuelo-1'))
            ->assertStatus(404);
    }

    public function test_the_action_is_all_or_nothing_over_the_whole_selection(): void
    {
        [$owner, $workspace] = $this->workspace();
        $fine = $this->link($owner, $workspace, 'normal');
        $blocked = $this->link($owner, $workspace, 'bloqueado');
        Link::where('id', $blocked)->update(['state' => 'blocked']);
        $this->signIn($owner, $workspace);

        $this->postJson('/api/v1/links/bulk', ['action' => 'pause', 'linkIds' => [$fine, $blocked]], $this->headers('clave-atomica-1'))
            ->assertStatus(403);
        $this->assertSame('active', (string) Link::where('id', $fine)->value('state'));
    }

    public function test_bulk_actions_move_tags_collections_and_the_trash(): void
    {
        [$owner, $workspace] = $this->workspace();
        $one = $this->link($owner, $workspace, 'uno');
        $two = $this->link($owner, $workspace, 'dos');
        $collectionId = DB::table('collections')->insertGetId(['workspace_id' => $workspace->id, 'name' => 'Campaña']);
        $this->signIn($owner, $workspace);

        $this->postJson('/api/v1/links/bulk', ['action' => 'tag', 'linkIds' => [$one, $two], 'tags' => ['prensa', '2026']], $this->headers('clave-etiqueta-1'))
            ->assertOk()->assertJson(['applied' => 2]);
        // Dos enlaces por dos etiquetas: cuatro adhesiones.
        $this->assertSame(4, DB::table('link_tags')->count());

        $this->postJson('/api/v1/links/bulk', ['action' => 'untag', 'linkIds' => [$one], 'tags' => ['prensa']], $this->headers('clave-etiqueta-2'))
            ->assertOk();
        $this->assertSame(1, DB::table('link_tags')->where('link_id', $one)->count());

        $this->postJson('/api/v1/links/bulk', ['action' => 'move', 'linkIds' => [$one, $two], 'collectionId' => $collectionId], $this->headers('clave-mover-1'))
            ->assertOk()->assertJson(['applied' => 2]);
        $this->assertSame([$collectionId, $collectionId], Link::whereIn('id', [$one, $two])->orderBy('id')->pluck('collection_id')->all());

        $this->postJson('/api/v1/links/bulk', ['action' => 'trash', 'linkIds' => [$one, $two]], $this->headers('clave-papelera-1'))
            ->assertOk()->assertJson(['applied' => 2]);
        // Link usa SoftDeletes: el alcance global filtraría los borrados en
        // una consulta Eloquent, así que se mira la tabla directamente.
        $this->assertSame(2, DB::table('links')->whereNotNull('deleted_at')->count());

        $this->postJson('/api/v1/links/bulk', ['action' => 'restore', 'linkIds' => [$one, $two]], $this->headers('clave-restaurar-1'))
            ->assertOk()->assertJson(['applied' => 2]);
        $this->assertSame(2, Link::whereNull('deleted_at')->count());
        $this->assertSame(0, DB::table('links')->whereNotNull('deleted_at')->count());
    }

    /** @return array{0: User, 1: Workspace} */
    private function workspace(): array
    {
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Escala', 'slug' => 'escala-'.Ids::randomToken(8)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);

        return [$owner, $workspace];
    }

    private function link(User $owner, Workspace $workspace, string $alias, bool $otherWorkspace = false): int
    {
        $workspaceId = $workspace->id;
        if ($otherWorkspace) {
            $foreign = $owner->ownedWorkspaces()->create(['name' => 'Otra', 'slug' => 'otra-'.Ids::randomToken(8)]);
            $foreign->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
            $workspaceId = $foreign->id;
        }

        return Link::insertGetId([
            'workspace_id' => $workspaceId,
            'created_by' => $owner->id,
            'alias' => $alias.'-'.Ids::randomToken(4),
            'destination' => 'https://example.org/'.$alias,
            'state' => 'active',
            'version' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function signIn(User $user, Workspace $workspace): void
    {
        $this->withCookie((string) config('uvh.session_cookie'), SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $workspace->id);
    }

    /** @return array<string, string> */
    private function headers(string $key): array
    {
        return ['Idempotency-Key' => $key];
    }
}
