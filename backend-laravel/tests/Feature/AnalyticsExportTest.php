<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Workspace;
use App\Support\AnalyticsService;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Export de analítica (F7f): CSV y JSON del mismo overview que ve la
 * pantalla. El contrato de privacidad es el punto: el export son AGREGADOS —
 *nunca sale un hash de visitante, ni como valor ni como columna— porque un
 * archivo que se descarga viaja más allá del workspace y de la retención que
 * limita la analítica en pantalla. El CSV pasa además por el guardado
 * anti-fórmulas: una dimensión que el visitante controla (el referrer) no
 * puede ejecutar nada al abrirse en una hoja de cálculo. Prepared contracts:
 * run only with the isolated *_test DB guard.
 */
final class AnalyticsExportTest extends TestCase
{
    private int $linkId;

    private User $owner;

    private Workspace $workspace;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, quotas, links, tags, link_tags, click_events, metric_rollups, metric_unique_visitors, operational_metrics, audit_events RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();

        $this->owner = User::factory()->create(['email_verified_at' => now()]);
        $this->workspace = $this->owner->ownedWorkspaces()->create([
            'name' => 'Analítica',
            'slug' => 'analitica-'.Ids::randomToken(8),
        ]);
        $this->workspace->memberships()->create(['user_id' => $this->owner->id, 'role' => 'owner']);
        $this->linkId = DB::table('links')->insertGetId([
            'workspace_id' => $this->workspace->id,
            'created_by' => $this->owner->id,
            'alias' => 'export-'.Ids::randomToken(4),
            'destination' => 'https://example.org/export',
            'state' => 'active',
            'version' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->signIn();
    }

    public function test_the_csv_export_carries_only_aggregates_and_guards_formulas(): void
    {
        // Dos personas reales detrás de tres clics: los hashes son material
        // identificativo y no pueden aparecer en el archivo.
        AnalyticsService::recordClick($this->linkId, $this->meta('ES', 'hash-visitante-uno'));
        AnalyticsService::recordClick($this->linkId, $this->meta('ES', 'hash-visitante-uno'));
        AnalyticsService::recordClick($this->linkId, $this->meta('PT', 'hash-visitante-dos', '=HYPERLINK("evil.example")'));

        $response = $this->getJson('/api/v1/analytics/export');
        $response->assertOk()->assertHeader('Content-Type', 'text/csv; charset=UTF-8');
        $disposition = (string) $response->headers->get('Content-Disposition');
        $this->assertStringContainsString('attachment; filename="uvh-analytics-', $disposition);
        // Laravel completa la cabecera con «, private»; el token que importa
        // es no-store: el export nunca queda en caché.
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
        $body = (string) $response->getContent();

        // Sólo agregados: totales, serie diaria y dimensiones con conteos.
        $this->assertStringContainsString('totals,,,3,2', $body);
        $this->assertStringContainsString('series,,', $body);
        $this->assertStringContainsString('countries,ES,,2,', $body);
        $this->assertStringContainsString('countries,PT,,1,', $body);

        // El referrer lo elige el visitante: la celda sale neutralizada y sin
        // fórmula viva al principio de línea.
        $this->assertStringContainsString("'=HYPERLINK", $body);
        $this->assertStringNotContainsString("\n=HYPERLINK", $body);

        // Ni valores ni columnas con hashes de visitante.
        $this->assertStringNotContainsString('hash-visitante', $body);
        $this->assertStringNotContainsString('visitor_hash', $body);
    }

    public function test_the_json_export_is_the_same_overview_and_carries_no_hashes(): void
    {
        AnalyticsService::recordClick($this->linkId, $this->meta('ES', 'hash-visitante-uno'));
        AnalyticsService::recordClick($this->linkId, $this->meta('ES', 'hash-visitante-uno'));
        AnalyticsService::recordClick($this->linkId, $this->meta('PT', 'hash-visitante-dos'));

        $response = $this->getJson('/api/v1/analytics/export?format=json');
        $response->assertOk()->assertHeader('Content-Type', 'application/json; charset=UTF-8');
        $data = $response->json();

        $this->assertSame(3, $data['totals']['clicks']);
        $this->assertSame(2, $data['totals']['visitors']);
        // La métrica se declara: rotación diaria, no identificación de personas.
        $this->assertSame('daily_pseudonyms', $data['visitorMetric']);
        $this->assertCount(1, $data['topLinks']);
        $this->assertSame(3, $data['topLinks'][0]['clicks']);
        $this->assertSame(2, $data['topLinks'][0]['visitors']);

        $body = (string) $response->getContent();
        $this->assertStringNotContainsString('hash-visitante', $body);
        $this->assertStringNotContainsString('visitor_hash', $body);
    }

    public function test_an_unknown_format_a_partial_range_or_a_foreign_link_are_refused(): void
    {
        $this->getJson('/api/v1/analytics/export?format=xml')->assertStatus(422);
        $this->getJson('/api/v1/analytics/export?period=custom')->assertStatus(422);
        $this->getJson('/api/v1/analytics/export?linkId=abc')->assertStatus(422);

        $foreignOwner = User::factory()->create(['email_verified_at' => now()]);
        $foreign = $foreignOwner->ownedWorkspaces()->create([
            'name' => 'Ajena',
            'slug' => 'ajena-'.Ids::randomToken(8),
        ]);
        $foreign->memberships()->create(['user_id' => $foreignOwner->id, 'role' => 'owner']);
        $foreignLink = DB::table('links')->insertGetId([
            'workspace_id' => $foreign->id,
            'created_by' => $foreignOwner->id,
            'alias' => 'ajeno-'.Ids::randomToken(4),
            'destination' => 'https://example.org/ajeno',
            'state' => 'active',
            'version' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->getJson('/api/v1/analytics/export?linkId='.$foreignLink)->assertStatus(404);
    }

    /** @return array<string, string|null> */
    private function meta(string $country, string $visitorHash, string $referrer = 'ejemplo.example'): array
    {
        return [
            'country' => $country,
            'device' => 'desktop',
            'browser' => 'Firefox',
            'os' => 'Linux',
            'referrer_domain' => $referrer,
            'campaign' => null,
            'visitor_hash' => $visitorHash,
        ];
    }

    private function signIn(): void
    {
        $this->withCookie((string) config('uvh.session_cookie'), SessionManager::create($this->owner->id, Request::create('/'), (int) $this->owner->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $this->workspace->id);
    }
}
