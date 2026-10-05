<?php

namespace Tests\Feature;

use App\Http\Controllers\LinkCsvController;
use App\Models\CustomDomain;
use App\Models\Link;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\UvhRequest;
use Illuminate\Database\Events\QueryExecuted;
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
        $response->assertOk()->assertJson(['dryRun' => true, 'valid' => 1, 'created' => 0, 'failed' => 0]);
        $errors = $response->json('errors');
        $this->assertSame([3, 4], array_column($errors, 'row'));
        $this->assertSame(0, Link::count());
    }

    public function test_preflight_checks_duplicate_aliases_existing_aliases_quota_and_domain_readiness(): void
    {
        [$owner, $workspace] = $this->workspace();
        $workspace->quota()->update(['links_limit' => 2]);
        Link::create([
            'workspace_id' => $workspace->id, 'created_by' => $owner->id, 'alias' => 'existing',
            'destination' => 'https://example.org', 'state' => 'active',
        ]);
        CustomDomain::create([
            'workspace_id' => $workspace->id, 'domain' => 'not-ready.example.test',
            'verification_token' => 'fixture',
            'desired_state' => 'enabled', 'ownership_status' => 'pending',
            'routing_status' => 'unknown', 'tls_status' => 'pending',
        ]);
        $this->signIn($owner, $workspace);
        $csv = "alias,domain,destination\nexisting,,https://example.org\nfresh,,https://example.org\nfresh,,https://example.org\nover-quota,,https://example.org\nunready,not-ready.example.test,https://example.org\n";
        $response = $this->postJson('/api/v1/links/import', ['dryRun' => true, 'csv' => $csv]);
        $response->assertOk()->assertJson(['valid' => 1, 'created' => 0]);
        $this->assertSame([2, 4, 5, 6], array_column($response->json('errors'), 'row'));
        $this->assertSame('Este alias ya está en uso', $response->json('errors.0.error'));
        $this->assertSame('Cuota de enlaces alcanzada', $response->json('errors.2.error'));
        $this->assertSame('Dominio no activado o sin acceso', $response->json('errors.3.error'));
        $this->assertDatabaseCount('links', 1);
        $this->assertDatabaseCount('idempotency_keys', 0);
        $this->assertDatabaseCount('link_import_batches', 0);
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
        // Los contadores no se solapan: la fila 4 falló al crear y NO cuenta
        // como válida —sólo la fila 2 creó su enlace—. Fila 3: destino
        // inválido (rechazada en validación). Fila 4: alias repetido dentro
        // del mismo archivo, ya creado por la fila 2 (fallida al crear).
        $first->assertOk()->assertJson(['dryRun' => false, 'valid' => 1, 'created' => 1, 'failed' => 1]);
        $this->assertSame(1, Link::count());
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

    public function test_a_uv_h_export_reimports_as_the_same_links(): void
    {
        // Round-trip: el archivo que UVH emite vuelve a entrar en UVH sin
        // romperse —columnas de sólo lectura ignoradas, fórmulas des-escapadas,
        // dominio resuelto por hostname—. Se importa sobre un workspace vacío:
        // la transferencia real es de A a B, y los alias no pueden duplicarse.
        [$owner, $workspace] = $this->workspace();
        $domain = CustomDomain::create([
            'workspace_id' => $workspace->id, 'domain' => 'go.example.test',
            'verification_token' => 'uvh-verify='.Ids::randomToken(24),
            'desired_state' => 'enabled', 'ownership_status' => 'verified',
            'routing_status' => 'healthy', 'tls_status' => 'ready',
            'verified_at' => now()->subDay(), 'ownership_verified_at' => now()->subDay(),
            'routing_verified_at' => now()->subDay(), 'edge_eligible' => true,
            'tls_ready_at' => now()->subDay(),
        ]);
        $simple = Link::insertGetId([
            'workspace_id' => $workspace->id, 'created_by' => $owner->id,
            'alias' => 'simple', 'destination' => 'https://example.org/uno',
            'notes' => '=SUM(A1:A9)', 'max_clicks' => 5, 'single_use' => true,
            'expires_at' => now()->addDays(7), 'state' => 'active', 'version' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $onDomain = Link::insertGetId([
            'workspace_id' => $workspace->id, 'created_by' => $owner->id,
            'domain_id' => $domain->id, 'alias' => 'dominio',
            'destination' => 'https://example.org/dos', 'state' => 'active', 'version' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        foreach (['prensa', '2026', 'prensa;2026', '[literal]'] as $name) {
            DB::table('link_tags')->insert([[
                'link_id' => $simple,
                'tag_id' => DB::table('tags')->insertGetId(['workspace_id' => $workspace->id, 'name' => $name]),
            ]]);
        }
        DB::table('link_tags')->insert([['link_id' => $onDomain, 'tag_id' => DB::table('tags')->where('name', 'prensa')->value('id')]]);
        $this->signIn($owner, $workspace);

        $csv = (string) $this->getJson('/api/v1/links/export.csv')->assertOk()->getContent();

        // El origen se vacía: el archivo debe poder recrear TODO lo que describe.
        DB::statement('TRUNCATE links, link_tags RESTART IDENTITY CASCADE');

        $this->postJson('/api/v1/links/import', ['dryRun' => true, 'csv' => $csv])
            ->assertOk()->assertJson(['dryRun' => true, 'valid' => 2, 'created' => 0, 'failed' => 0, 'errors' => []]);

        $this->postJson('/api/v1/links/import', ['dryRun' => false, 'csv' => $csv], ['Idempotency-Key' => 'import-roundtrip-1'])
            ->assertOk()->assertJson(['dryRun' => false, 'valid' => 2, 'created' => 2, 'failed' => 0, 'errors' => []]);

        $recreated = Link::with('tags')->orderBy('id')->get()->keyBy('alias');
        $this->assertCount(2, $recreated);
        $simpleAgain = $recreated['simple'];
        // La nota sale del export como `'=SUM(A1:A9)` y debe volver a entrar
        // como `=SUM(A1:A9)`: la comilla es protección de hoja, no contenido.
        $this->assertSame('=SUM(A1:A9)', (string) $simpleAgain->notes);
        $this->assertSame(5, (int) $simpleAgain->max_clicks);
        $this->assertTrue((bool) $simpleAgain->single_use);
        $this->assertSame(['2026', '[literal]', 'prensa', 'prensa;2026'], $simpleAgain->tags->pluck('name')->sort()->values()->all());
        $onDomainAgain = $recreated['dominio'];
        $this->assertSame((int) $domain->id, (int) $onDomainAgain->domain_id, 'the domain column must resolve to the target workspace domain');
        $this->assertSame('https://example.org/dos', (string) $onDomainAgain->destination);
    }

    public function test_the_domain_column_resolves_by_hostname_and_reports_unknown_hosts(): void
    {
        [$owner, $workspace] = $this->workspace();
        $domain = CustomDomain::create([
            'workspace_id' => $workspace->id, 'domain' => 'go.example.test',
            'verification_token' => 'uvh-verify='.Ids::randomToken(24),
            'desired_state' => 'enabled', 'ownership_status' => 'verified',
            'routing_status' => 'healthy', 'tls_status' => 'ready',
            'verified_at' => now()->subDay(), 'ownership_verified_at' => now()->subDay(),
            'routing_verified_at' => now()->subDay(), 'edge_eligible' => true,
            'tls_ready_at' => now()->subDay(),
        ]);
        $this->signIn($owner, $workspace);

        $csv = "alias,domain,destination\n".
            "con-dominio,go.example.test,https://example.org/a\n".
            "sin-dominio,desconocido.example.test,https://example.org/b\n".
            "por-defecto,,https://example.org/c\n";

        $response = $this->postJson('/api/v1/links/import', ['dryRun' => false, 'csv' => $csv], ['Idempotency-Key' => 'import-dominio-1']);
        $response->assertOk()->assertJson(['valid' => 2, 'created' => 2]);
        // La cabecera es la fila 1: el hostname desconocido es la fila 3.
        $this->assertSame([3], array_column($response->json('errors'), 'row'));
        $this->assertStringContainsString('no existe en este workspace', (string) $response->json('errors.0.error'));

        $this->assertSame((int) $domain->id, (int) Link::where('alias', 'con-dominio')->value('domain_id'));
        $this->assertNull(Link::where('alias', 'por-defecto')->value('domain_id'));
        $this->assertSame(0, Link::where('alias', 'sin-dominio')->count());
    }

    public function test_a_crashed_import_resumes_instead_of_duplicating_rows(): void
    {
        [$owner, $workspace] = $this->workspace();
        $this->signIn($owner, $workspace);
        $csv = "alias,destination\n".
            "fila-uno,https://example.org/1\n".
            "fila-dos,https://example.org/2\n".
            "fila-tres,https://example.org/3\n";

        // El proceso muere al anotar la fila 3 (segunda de datos; la cabecera
        // es la 1): la fila 2 ya quedó creada y anotada en su transacción, la 3
        // se revierte entera y la 4 no llega a correr.
        $crash = true;
        DB::listen(static function (QueryExecuted $event) use (&$crash): void {
            if ($crash && str_contains($event->sql, '"link_import_rows"') && ($event->bindings[1] ?? null) === 3) {
                throw new \RuntimeException('Fixture: import crashed mid-file');
            }
        });

        $this->postJson('/api/v1/links/import', ['dryRun' => false, 'csv' => $csv], ['Idempotency-Key' => 'import-crash-1'])
            ->assertStatus(500);
        $this->assertSame(1, Link::count(), 'only the rows committed before the crash exist');

        // El reintento con la MISMA clave reanuda: reproduce la fila 2 desde su
        // registro y crea sólo las que faltan. El resultado final es el de la
        // intención original, sin duplicar lo ya creado.
        $crash = false;
        $retry = $this->postJson('/api/v1/links/import', ['dryRun' => false, 'csv' => $csv], ['Idempotency-Key' => 'import-crash-1']);
        $retry->assertOk()->assertJson(['dryRun' => false, 'valid' => 3, 'created' => 3, 'errors' => []]);
        $this->assertSame(3, Link::count());
        $this->assertSame(3, DB::table('link_import_rows')->count());
        $this->assertSame(
            ['fila-dos', 'fila-tres', 'fila-uno'],
            Link::orderBy('alias')->pluck('alias')->values()->all(),
        );

        // Y una repetición posterior recibe el resultado sellado, tal cual.
        $replay = $this->postJson('/api/v1/links/import', ['dryRun' => false, 'csv' => $csv], ['Idempotency-Key' => 'import-crash-1']);
        $replay->assertOk()->assertExactJson($retry->json())->assertHeader('Idempotent-Replay', 'true');
    }

    public function test_takeover_between_rows_replays_the_ledger_and_fences_the_old_attempt(): void
    {
        [$owner, $workspace] = $this->workspace();
        $this->signIn($owner, $workspace);
        $payload = ['dryRun' => false, 'csv' => "alias,destination\none,https://example.org/1\ntwo,https://example.org/2\nthree,https://example.org/3\n"];
        $sessionId = DB::table('sessions')->where('user_id', $owner->id)->value('id');
        $takeover = true;
        $replacement = null;
        DB::listen(function (QueryExecuted $event) use (&$takeover, &$replacement, $owner, $workspace, $payload, $sessionId): void {
            if (! $takeover || ! str_starts_with(strtolower($event->sql), 'insert into "link_import_rows"')) {
                return;
            }
            $takeover = false;
            DB::afterCommit(function () use (&$replacement, $owner, $workspace, $payload, $sessionId): void {
                // A was suspended between committed rows beyond the lease.
                DB::table('idempotency_keys')->where('key', 'import-takeover')->update(['lease_until' => now()->subMinute()]);
                $retry = Request::create('/api/v1/links/import', 'POST', [], [], [], ['CONTENT_TYPE' => 'application/json'], json_encode($payload));
                $retry->headers->set('Idempotency-Key', 'import-takeover');
                $retry->attributes->set(UvhRequest::USER, $owner);
                $retry->attributes->set(UvhRequest::WORKSPACE_ID, (int) $workspace->id);
                $retry->attributes->set(UvhRequest::SESSION_ID, $sessionId);
                $replacement = (new LinkCsvController)->import($retry);
            });
        });
        $this->postJson('/api/v1/links/import', $payload, ['Idempotency-Key' => 'import-takeover'])->assertStatus(409);
        $this->assertNotNull($replacement);
        $this->assertSame(200, $replacement->getStatusCode());
        $this->assertSame(3, $replacement->getData(true)['created']);
        $this->assertSame(3, $replacement->getData(true)['valid']);
        $this->assertSame(0, $replacement->getData(true)['failed']);
        $this->assertSame([], $replacement->getData(true)['errors']);
        $this->assertSame(3, Link::count());
        $this->assertDatabaseCount('link_import_rows', 3);
        $this->postJson('/api/v1/links/import', $payload, ['Idempotency-Key' => 'import-takeover'])
            ->assertOk()->assertExactJson($replacement->getData(true))->assertHeader('Idempotent-Replay', 'true');
    }

    public function test_active_import_renews_ledger_retention_alongside_its_reservation(): void
    {
        [$owner, $workspace] = $this->workspace();
        $this->signIn($owner, $workspace);
        $rows = 0;
        DB::listen(function (QueryExecuted $event) use (&$rows): void {
            if (! str_starts_with(strtolower($event->sql), 'insert into "link_import_rows"')) {
                return;
            }
            $rows++;
            $committedRow = $rows;
            DB::afterCommit(function () use ($committedRow): void {
                if ($committedRow === 1) {
                    $this->travel(23)->hours();
                } elseif ($committedRow === 2) {
                    $this->travel(2)->hours();
                    $this->assertSame(0, DB::table('link_import_batches')->where('expires_at', '<', now())->delete());
                }
            });
        });
        $this->postJson('/api/v1/links/import', [
            'dryRun' => false,
            'csv' => "alias,destination\nfirst,https://example.org\nsecond,https://example.org\nthird,https://example.org\n",
        ], ['Idempotency-Key' => 'import-renew-retention'])->assertOk()->assertJson(['created' => 3, 'errors' => []]);
        $this->assertDatabaseCount('link_import_rows', 3);
    }

    public function test_json_tag_cells_require_a_list_and_cannot_mix_with_legacy_tags(): void
    {
        [$owner, $workspace] = $this->workspace();
        $this->signIn($owner, $workspace);
        foreach (['{}', 'null', '{broken', '42'] as $invalid) {
            $this->postJson('/api/v1/links/import', [
                'dryRun' => true, 'csv' => "alias,destination,tags_json\na,https://example.org,".$invalid,
            ])->assertOk()->assertJson(['valid' => 0]);
        }
        $this->postJson('/api/v1/links/import', [
            'dryRun' => true, 'csv' => "alias,destination,tags,tags_json\na,https://example.org,legacy,[]",
        ])->assertStatus(422);
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
