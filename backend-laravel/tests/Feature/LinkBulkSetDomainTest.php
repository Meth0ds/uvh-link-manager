<?php

namespace Tests\Feature;

use App\Models\CustomDomain;
use App\Models\Link;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * La acción masiva «cambiar dominio» re-apunta las URLs públicas de toda una
 * selección: se aplica completa o no se aplica, exige un destino que esté
 * sirviendo y nunca deja un alias duplicado en el destino. Prepared
 * contracts: run only with the *_test DB guard.
 */
final class LinkBulkSetDomainTest extends TestCase
{
    private const CSRF = 'bulk-domain-csrf';

    protected function setUp(): void
    {
        parent::setUp(); // Refuses non-*_test databases before fixture writes.
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, quotas, links, tags, link_tags, idempotency_keys, collections, custom_domains, custom_domain_claims, domain_events, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', self::CSRF)->withHeaders(['X-CSRF-Token' => self::CSRF]);
    }

    public function test_set_domain_moves_the_selection_and_reports_only_the_real_changes(): void
    {
        [$owner, $workspace] = $this->workspace();
        $target = $this->servingDomain($workspace, 'go.example.test');
        $loose = $this->link($owner, $workspace, 'suelto');
        $other = $this->link($owner, $workspace, 'otro');
        $already = $this->link($owner, $workspace, 'ya-alla', domainId: $target);
        $this->signIn($owner, $workspace);

        $this->postJson('/api/v1/links/bulk', [
            'action' => 'set-domain',
            'linkIds' => [$loose, $other, $already],
            'domainId' => $target,
        ], $this->headers('clave-dominio-1'))
            ->assertOk()->assertJson(['ok' => true, 'action' => 'set-domain', 'applied' => 2]);

        $this->assertSame(
            [$target, $target, $target],
            Link::whereIn('id', [$loose, $other, $already])->orderBy('id')->pluck('domain_id')->all(),
        );
        // Sólo los que cambiaron suben versión; el que ya estaba no se toca.
        $this->assertSame(2, (int) Link::where('id', $loose)->value('version'));
        $this->assertSame(1, (int) Link::where('id', $already)->value('version'));
    }

    public function test_an_alias_taken_on_the_target_aborts_the_whole_selection(): void
    {
        [$owner, $workspace] = $this->workspace();
        $target = $this->servingDomain($workspace, 'go.example.test');
        $settled = $this->link($owner, $workspace, 'compartido', domainId: $target);
        $settledAlias = (string) Link::where('id', $settled)->value('alias');
        $clash = $this->link($owner, $workspace, 'compartido', alias: $settledAlias);
        $fine = $this->link($owner, $workspace, 'libre');
        $this->signIn($owner, $workspace);

        // El enlace que ya vive en el destino sigue ocupando su alias: mover
        // el homónimo es un choque y la operación entera se rechaza.
        $this->postJson('/api/v1/links/bulk', [
            'action' => 'set-domain',
            'linkIds' => [$clash, $fine],
            'domainId' => $target,
        ], $this->headers('clave-dominio-2'))
            ->assertStatus(409);
        $this->assertNull(Link::where('id', $clash)->value('domain_id'));
        $this->assertNull(Link::where('id', $fine)->value('domain_id'));
    }

    public function test_duplicate_aliases_inside_the_selection_are_refused(): void
    {
        [$owner, $workspace] = $this->workspace();
        $target = $this->servingDomain($workspace, 'go.example.test');
        $source = $this->servingDomain($workspace, 'alt.example.test');
        $fromPlatform = $this->link($owner, $workspace, 'gemelo');
        $fromPlatformAlias = (string) Link::where('id', $fromPlatform)->value('alias');
        $fromSource = $this->link($owner, $workspace, 'gemelo', alias: $fromPlatformAlias, domainId: $source);
        $this->signIn($owner, $workspace);

        // Dos gemelos en dominios distintos conviven, pero no pueden aterrizar
        // juntos en el destino: el segundo choque es intra-selección.
        $this->postJson('/api/v1/links/bulk', [
            'action' => 'set-domain',
            'linkIds' => [$fromPlatform, $fromSource],
            'domainId' => $target,
        ], $this->headers('clave-dominio-3'))
            ->assertStatus(409);
        $this->assertNull(Link::where('id', $fromPlatform)->value('domain_id'));
        $this->assertSame($source, (int) Link::where('id', $fromSource)->value('domain_id'));
    }

    public function test_a_target_that_is_not_serving_is_refused(): void
    {
        [$owner, $workspace] = $this->workspace();
        $idle = $this->servingDomain($workspace, 'idle.example.test', serving: false);
        $link = $this->link($owner, $workspace, 'caido');
        $this->signIn($owner, $workspace);

        $this->postJson('/api/v1/links/bulk', [
            'action' => 'set-domain',
            'linkIds' => [$link],
            'domainId' => $idle,
        ], $this->headers('clave-dominio-4'))
            ->assertStatus(403)->assertJsonPath('error', 'Dominio no activado o sin acceso');
        $this->assertNull(Link::where('id', $link)->value('domain_id'));

        // Un dominio ajeno al workspace no es un destino válido.
        [$foreignOwner, $foreign] = $this->workspace();
        $foreignDomain = $this->servingDomain($foreign, 'foreign.example.test');
        $this->postJson('/api/v1/links/bulk', [
            'action' => 'set-domain',
            'linkIds' => [$link],
            'domainId' => $foreignDomain,
        ], $this->headers('clave-dominio-5'))
            ->assertStatus(422)->assertJsonPath('error', 'Dominio no encontrado');
    }

    public function test_null_domain_moves_the_selection_back_to_the_platform(): void
    {
        [$owner, $workspace] = $this->workspace();
        $source = $this->servingDomain($workspace, 'go.example.test');
        $link = $this->link($owner, $workspace, 'vuelve', domainId: $source);
        $this->signIn($owner, $workspace);

        $this->postJson('/api/v1/links/bulk', [
            'action' => 'set-domain',
            'linkIds' => [$link],
            'domainId' => null,
        ], $this->headers('clave-dominio-6'))
            ->assertOk()->assertJson(['applied' => 1]);
        $this->assertNull(Link::where('id', $link)->value('domain_id'));
    }

    public function test_blocked_links_are_never_rehomed(): void
    {
        [$owner, $workspace] = $this->workspace();
        $target = $this->servingDomain($workspace, 'go.example.test');
        $blocked = $this->link($owner, $workspace, 'bloqueado');
        Link::where('id', $blocked)->update(['state' => 'blocked']);
        $fine = $this->link($owner, $workspace, 'normal');
        $this->signIn($owner, $workspace);

        $this->postJson('/api/v1/links/bulk', [
            'action' => 'set-domain',
            'linkIds' => [$fine, $blocked],
            'domainId' => $target,
        ], $this->headers('clave-dominio-7'))
            ->assertStatus(403);
        $this->assertNull(Link::where('id', $fine)->value('domain_id'));
        $this->assertNull(Link::where('id', $blocked)->value('domain_id'));
    }

    /** @return array{0: User, 1: Workspace} */
    private function workspace(): array
    {
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Dominios', 'slug' => 'dominios-'.Ids::randomToken(8)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);

        return [$owner, $workspace];
    }

    /**
     * Sirviendo de verdad (enabled + edge + certificado) o pendiente: el CHECK
     * de elegibilidad exige coherencia entre edge_eligible y tls_status.
     */
    private function servingDomain(Workspace $workspace, string $host, bool $serving = true): int
    {
        return (int) CustomDomain::create([
            'workspace_id' => $workspace->id,
            'domain' => $host,
            'verification_token' => 'uvh-verify=Bulk123456',
            'verification_version' => 1,
            'verification_scheme' => 2,
            'desired_state' => 'enabled',
            'ownership_status' => 'verified',
            'routing_status' => 'healthy',
            'tls_status' => $serving ? 'ready' : 'pending',
            'verified_at' => now(),
            'ownership_verified_at' => now(),
            'routing_verified_at' => now(),
            'edge_eligible' => $serving,
            'tls_ready_at' => $serving ? now() : null,
        ])->id;
    }

    private function link(User $owner, Workspace $workspace, string $slug, ?string $alias = null, ?int $domainId = null): int
    {
        return Link::insertGetId([
            'workspace_id' => $workspace->id,
            'created_by' => $owner->id,
            'domain_id' => $domainId,
            'alias' => $alias ?? ($slug.'-'.Ids::randomToken(4)),
            'destination' => 'https://example.org/'.$slug,
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
