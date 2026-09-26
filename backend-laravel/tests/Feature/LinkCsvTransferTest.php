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
 * Import/export CSV de enlaces (F7): el export nunca deja salir una fórmula
 * sin neutralizar y la importación valida fila a fila —con `dryRun` que no
 * escribe nada— sin frenar el resto del archivo. Prepared contracts: run only
 * with the isolated *_test DB guard.
 */
final class LinkCsvTransferTest extends TestCase
{
    private const CSRF = 'csv-csrf';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, quotas, links, tags, link_tags, idempotency_keys, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', self::CSRF)->withHeaders(['X-CSRF-Token' => self::CSRF]);
    }

    public function test_the_export_is_a_guarded_csv_of_the_whole_workspace(): void
    {
        [$owner, $workspace] = $this->workspace();
        $id = Link::insertGetId([
            'workspace_id' => $workspace->id, 'created_by' => $owner->id,
            'alias' => 'formula', 'destination' => 'https://example.org/dos',
            'notes' => '=SUM(A1:A9)', 'state' => 'active', 'version' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('link_tags')->insert([['link_id' => $id, 'tag_id' => DB::table('tags')->insertGetId(['workspace_id' => $workspace->id, 'name' => 'prensa'])]]);
        $this->signIn($owner, $workspace);

        $response = $this->getJson('/api/v1/links/export.csv');
        $response->assertOk()->assertHeader('Content-Type', 'text/csv; charset=UTF-8');
        $body = (string) $response->getContent();

        // Toda celda que una hoja ejecutaría sale con la comilla protectora.
        $this->assertStringContainsString("'=SUM(A1:A9)", $body);
        $this->assertStringNotContainsString("\n=SUM", $body);
        $this->assertStringContainsString('prensa', $body);
        $this->assertStringContainsString('alias,domain,destination', $body);
    }

    public function test_a_dry_run_reports_every_row_without_writing_anything(): void
    {
        [$owner, $workspace] = $this->workspace();
        $this->signIn($owner, $workspace);

        $csv = "alias,destination,tags\n".
            "valido,https://example.org/ok,a;b\n".
            "mal-destino,esto-no-es-una-url,\n".
            "MAL ALIAS!!,https://example.org/x,\n";

        $response = $this->postJson('/api/v1/links/import', ['dryRun' => true, 'csv' => $csv]);
        $response->assertOk()->assertJson(['dryRun' => true, 'valid' => 1, 'created' => 0]);
        $errors = $response->json('errors');
        $this->assertSame([3, 4], array_column($errors, 'row'));
        $this->assertSame(0, Link::count());
    }

    public function test_the_real_import_creates_the_valid_rows_reports_the_rest_and_replays(): void
    {
        [$owner, $workspace] = $this->workspace();
        $this->signIn($owner, $workspace);

        $csv = "alias,destination,tags\n".
            "valido,https://example.org/ok,a;b\n".
            "mal-destino,esto-no-es-una-url,\n".
            "valido,https://example.org/duplicado,\n";

        $first = $this->postJson('/api/v1/links/import', ['dryRun' => false, 'csv' => $csv], ['Idempotency-Key' => 'import-clave-1']);
        $first->assertOk()->assertJson(['dryRun' => false, 'valid' => 2, 'created' => 1]);
        $this->assertSame(1, Link::count());
        // Fila 3: destino inválido. Fila 4: el alias repetido dentro del mismo
        // archivo sólo falla al crear, y cada fallo es de una fila, no del lote.
        $this->assertSame([3, 4], array_column($first->json('errors'), 'row'));

        // La repetición devuelve el resultado original y no crea nada más: una
        // re-importación accidental no duplica el enlace que sí valía.
        $replay = $this->postJson('/api/v1/links/import', ['dryRun' => false, 'csv' => $csv], ['Idempotency-Key' => 'import-clave-1']);
        $replay->assertOk()->assertExactJson($first->json());
        $this->assertSame(1, Link::count());
    }

    public function test_the_import_refuses_unknown_columns_and_an_unbounded_file(): void
    {
        [$owner, $workspace] = $this->workspace();
        $this->signIn($owner, $workspace);

        $this->postJson('/api/v1/links/import', ['dryRun' => true, 'csv' => "alias,destination,secreto\na,https://example.org,x"])
            ->assertStatus(422);
        $this->postJson('/api/v1/links/import', ['dryRun' => true, 'csv' => "destination\nhttps://example.org"])
            ->assertStatus(422);

        $rows = implode("\n", array_map(fn (int $i): string => "a{$i},https://example.org/{$i}", range(1, 501)));
        $this->postJson('/api/v1/links/import', ['dryRun' => true, 'csv' => "alias,destination\n".$rows])
            ->assertStatus(422);

        // Crear sin clave es un error del cliente: la repetición duplicaría.
        $this->postJson('/api/v1/links/import', ['dryRun' => false, 'csv' => "alias,destination\na,https://example.org"])
            ->assertStatus(422);
    }

    /** @return array{0: User, 1: Workspace} */
    private function workspace(): array
    {
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'CSV', 'slug' => 'csv-'.Ids::randomToken(8)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);

        return [$owner, $workspace];
    }

    private function signIn(User $user, Workspace $workspace): void
    {
        $this->withCookie((string) config('uvh.session_cookie'), SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $workspace->id);
    }
}
