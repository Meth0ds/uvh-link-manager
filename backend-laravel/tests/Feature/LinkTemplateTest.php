<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Plantillas de enlace (F7): valores por defecto guardados YA VALIDADOS con
 * las reglas del enlace real, y nunca un alias. Prepared contracts: run only
 * with the *_test DB guard.
 */
final class LinkTemplateTest extends TestCase
{
    private const CSRF = 'template-csrf';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, quotas, link_templates, collections, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', self::CSRF)->withHeaders(['X-CSRF-Token' => self::CSRF]);
    }

    public function test_a_template_round_trips_and_never_saves_an_alias(): void
    {
        [$owner, $workspace] = $this->workspace();
        $this->signIn($owner, $workspace);

        $created = $this->postJson('/api/v1/link-templates', [
            'name' => 'Prensa',
            'payload' => ['destination' => 'https://example.org/nota', 'notes' => 'Plantilla de prensa', 'tags' => ['prensa']],
        ]);
        $created->assertStatus(201)->assertJson(['template' => ['name' => 'Prensa']]);
        $id = $created->json('template.id');

        $this->assertSame([['id' => $id, 'name' => 'Prensa']], collect($this->getJson('/api/v1/link-templates')->json('templates'))
            ->map(fn (array $t): array => ['id' => $t['id'], 'name' => $t['name']])->all());

        // Un alias en el payload chocaría al primer uso: se rechaza al guardar.
        $this->postJson('/api/v1/link-templates', [
            'name' => 'Con alias',
            'payload' => ['destination' => 'https://example.org/x', 'alias' => 'fijo'],
        ])->assertStatus(422);

        $this->deleteJson('/api/v1/link-templates/'.$id)->assertOk();
        $this->assertSame(0, DB::table('link_templates')->count());
    }

    public function test_a_template_is_validated_when_saved_not_when_applied(): void
    {
        [$owner, $workspace] = $this->workspace();
        $this->signIn($owner, $workspace);

        // Un destino imposible no llega a guardarse: una plantilla rota sería
        // un error descubierto en el momento peor, al crear un enlace.
        $this->postJson('/api/v1/link-templates', [
            'name' => 'Rota',
            'payload' => ['destination' => 'esto-no-es-una-url'],
        ])->assertStatus(422);

        $this->postJson('/api/v1/link-templates', [
            'name' => 'Campos desconocidos',
            'payload' => ['destination' => 'https://example.org/x', 'password' => 'secreto'],
        ])->assertStatus(422);

        $this->postJson('/api/v1/link-templates', [
            'name' => 'Válida',
            'payload' => ['destination' => 'https://example.org/x'],
        ])->assertStatus(201);
        $this->postJson('/api/v1/link-templates', [
            'name' => 'válida',
            'payload' => ['destination' => 'https://example.org/y'],
        ])->assertStatus(409);
    }

    private function workspace(): array
    {
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Plantillas', 'slug' => 'plantillas-'.Ids::randomToken(8)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);

        return [$owner, $workspace];
    }

    private function signIn(User $user, Workspace $workspace): void
    {
        $this->withCookie((string) config('uvh.session_cookie'), SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $workspace->id);
    }
}
