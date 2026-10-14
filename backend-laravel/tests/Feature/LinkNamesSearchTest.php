<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\CustomDomain;
use App\Models\Link;
use App\Models\User;
use App\Models\Workspace;
use App\Support\AccountExportDocument;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

final class LinkNamesSearchTest extends TestCase
{
    private User $owner;

    private Workspace $workspace;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, audit_events RESTART IDENTITY CASCADE');
        Queue::fake();
        config(['workflows.enabled' => true]);
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'names-csrf')->withHeader('X-CSRF-Token', 'names-csrf');
        $this->owner = User::factory()->create(['email_verified_at' => now()]);
        $this->workspace = $this->owner->ownedWorkspaces()->create(['name' => 'Names', 'slug' => Ids::randomToken(12)]);
        $this->workspace->memberships()->create(['user_id' => $this->owner->id, 'role' => 'owner']);
        $this->signIn($this->owner);
    }

    private function signIn(User $user): void
    {
        $this->withCookie((string) config('uvh.session_cookie'), SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $this->workspace->id);
    }

    private function link(array $values = []): Link
    {
        return Link::create(array_merge(['workspace_id' => $this->workspace->id, 'created_by' => $this->owner->id, 'alias' => 'link-'.Ids::randomToken(8), 'destination' => 'https://example.org/menu', 'state' => 'active', 'version' => 1], $values));
    }

    public function test_name_is_normalized_and_partial_edits_preserve_or_clear_it(): void
    {
        $response = $this->withHeader('Idempotency-Key', 'names-create-001')->postJson('/api/v1/links', ['destination' => 'https://example.org/menu', 'name' => '  Carta — Octubre 🍽  '])->assertCreated();
        $id = $response->json('link.id');
        $response->assertJsonPath('link.name', 'Carta — Octubre 🍽');
        $short = $response->json('link.shortUrl');
        $updated = $this->patchJson('/api/v1/links/'.$id, ['version' => $response->json('link.version'), 'notes' => 'Only notes'])->assertOk();
        $updated->assertJsonPath('link.name', 'Carta — Octubre 🍽')->assertJsonPath('link.shortUrl', $short)->assertJsonPath('link.clickCount', 0);
        $this->patchJson('/api/v1/links/'.$id, ['version' => $updated->json('link.version'), 'name' => null])->assertOk()->assertJsonPath('link.name', null);
    }

    public function test_create_idempotency_replays_the_same_link_and_rejects_a_different_body(): void
    {
        $payload = ['destination' => 'https://example.org/idempotent', 'name' => 'Una sola vez'];
        $first = $this->withHeader('Idempotency-Key', 'link-create-replay-1')->postJson('/api/v1/links', $payload)->assertCreated();
        $second = $this->withHeader('Idempotency-Key', 'link-create-replay-1')->postJson('/api/v1/links', $payload)->assertCreated();

        self::assertSame($first->json('link.id'), $second->json('link.id'));
        self::assertSame(1, Link::where('workspace_id', $this->workspace->id)->where('destination', $payload['destination'])->count());
        self::assertArrayNotHasKey('password', $second->json('link'));
        self::assertArrayNotHasKey('passwordHash', $second->json('link'));

        $this->withHeader('Idempotency-Key', 'link-create-replay-1')->postJson('/api/v1/links', ['destination' => 'https://example.org/other'])->assertStatus(409);
    }

    public function test_invalid_names_are_rejected_and_unicode_limit_counts_characters(): void
    {
        foreach ([123, ['bad'], "bad\nname", "hidden\u{202e}name", str_repeat('é', 121)] as $value) {
            $this->withHeader('Idempotency-Key', Ids::randomToken(20))->postJson('/api/v1/links', ['destination' => 'https://example.org/', 'name' => $value])->assertStatus(422);
        }
        $this->withHeader('Idempotency-Key', 'names-unicode-120')->postJson('/api/v1/links', ['destination' => 'https://example.org/', 'name' => str_repeat('é', 120)])->assertCreated()->assertJsonPath('link.name', str_repeat('é', 120));
        $this->withHeader('Idempotency-Key', 'names-empty-001')->postJson('/api/v1/links', ['destination' => 'https://example.org/', 'name' => '   '])->assertCreated()->assertJsonPath('link.name', null);
    }

    public function test_duplicates_preserve_name_but_have_new_identity_and_statistics(): void
    {
        $link = $this->link(['name' => 'Carta', 'click_count' => 12]);
        $this->withHeader('Idempotency-Key', 'c3c5a2b0-71e8-4d2f-95e2-4a96dd581463')->postJson('/api/v1/links/'.$link->id.'/duplicate', ['sourceVersion' => (int) $link->version, 'alias' => 'copy-menu'])
            ->assertCreated()->assertJsonPath('link.name', 'Carta')->assertJsonPath('link.clickCount', 0);
    }

    public function test_library_and_trash_search_names_and_name_order_is_stable(): void
    {
        $this->link(['name' => 'Zulu', 'alias' => 'z']);
        $a = $this->link(['name' => 'Carta', 'alias' => 'technical-one']);
        $b = $this->link(['name' => 'Carta', 'alias' => 'technical-two']);
        $this->link(['alias' => 'alpha']);
        $this->getJson('/api/v1/links?q=carta')->assertOk()->assertJsonPath('total', 2);
        $ids = $this->getJson('/api/v1/links?sort=name_asc')->assertOk()->json('links.*.id');
        self::assertSame([$a->id, $b->id], array_slice($ids, 1, 2));
        $a->delete();
        $this->getJson('/api/v1/links/trash?q=carta')->assertOk()->assertJsonPath('total', 1);
    }

    public function test_search_is_ranked_bounded_and_never_projects_private_fields(): void
    {
        for ($i = 0; $i < 12; $i++) {
            $this->link(['name' => 'Carta '.$i, 'notes' => 'sensitive-note', 'password_hash' => 'secret-hash']);
        }
        $exact = $this->link(['name' => 'Carta']);
        for ($i = 0; $i < 6; $i++) {
            CustomDomain::create(['workspace_id' => $this->workspace->id, 'domain' => 'carta'.$i.'.example.org', 'verification_token' => 'secret-dns']);
        }
        $response = $this->getJson('/api/v1/search?q=carta')->assertOk()->assertJsonCount(10, 'links')->assertJsonCount(5, 'domains')->assertJsonPath('moreLinks', true)->assertJsonPath('moreDomains', true)->assertJsonPath('links.0.id', $exact->id);
        self::assertSame(['id', 'name', 'shortUrl', 'state'], array_keys($response->json('links.0')));
        self::assertSame(['id', 'hostname', 'state'], array_keys($response->json('domains.0')));
        self::assertStringNotContainsString('secret', $response->getContent());
        self::assertStringNotContainsString('sensitive-note', $response->getContent());
    }

    public function test_search_supports_literal_wildcards_and_all_library_criteria(): void
    {
        $literal = $this->link(['name' => '100%_menu']);
        $this->link(['name' => '100XXmenu']);
        $this->getJson('/api/v1/search?q='.rawurlencode('%_'))->assertOk()->assertJsonCount(1, 'links')->assertJsonPath('links.0.id', $literal->id);
        $note = $this->link(['notes' => 'findme-secret']);
        $this->getJson('/api/v1/search?q=findme')->assertOk()->assertJsonPath('links.0.id', $note->id);
        $this->getJson('/api/v1/search?q=example.org')->assertOk()->assertJsonCount(3, 'links');
        $this->getJson('/api/v1/search?q=')->assertOk()->assertJsonCount(0, 'links');
        $this->getJson('/api/v1/search?q[]=bad')->assertStatus(422);
        $this->getJson('/api/v1/search?q='.str_repeat('a', 201))->assertStatus(422);
    }

    public function test_viewers_can_search_only_current_workspace_and_revocation_denies_access(): void
    {
        $viewer = User::factory()->create(['email_verified_at' => now()]);
        $membership = $this->workspace->memberships()->create(['user_id' => $viewer->id, 'role' => 'viewer']);
        $current = $this->link(['name' => 'Carta current']);
        $other = $this->owner->ownedWorkspaces()->create(['name' => 'Foreign', 'slug' => Ids::randomToken(12)]);
        $foreignDomain = CustomDomain::create(['workspace_id' => $other->id, 'domain' => 'foreign-private.example.org', 'verification_token' => 'secret-dns']);
        // Legacy inconsistent relations must not expose another workspace's domain.
        $current->update(['domain_id' => $foreignDomain->id]);
        $this->link(['workspace_id' => $other->id, 'name' => 'Carta foreign']);
        $deleted = $this->link(['name' => 'Carta deleted']);
        $deleted->delete();
        $this->signIn($viewer);
        $result = $this->getJson('/api/v1/search?q=carta')->assertOk()->assertJsonCount(1, 'links');
        self::assertStringNotContainsString('foreign-private', $result->getContent());
        $this->withHeader('Idempotency-Key', 'reader-name-write')->postJson('/api/v1/links', ['destination' => 'https://example.org/', 'name' => 'Reader'])->assertForbidden();
        $membership->delete();
        $this->getJson('/api/v1/search?q=carta')->assertForbidden();
    }

    public function test_csv_name_is_appended_guarded_and_old_csv_remains_valid(): void
    {
        $this->link(['name' => '=HYPERLINK("bad")']);
        $csv = $this->get('/api/v1/links/export.csv')->assertOk()->getContent();
        $header = str_getcsv(explode("\r\n", $csv)[0]);
        self::assertSame('name', array_pop($header));
        self::assertStringContainsString("'=HYPERLINK", $csv);
        $this->postJson('/api/v1/links/import', ['csv' => "alias,destination\nold-csv,https://example.org/", 'dryRun' => true])->assertOk()->assertJsonPath('valid', 1);
        $this->withHeader('Idempotency-Key', 'names-import-001')->postJson('/api/v1/links/import', ['csv' => "alias,destination,name\nnew-csv,https://example.org/,Carta importada"])->assertOk();
        self::assertSame('Carta importada', Link::where('alias', 'new-csv')->firstOrFail()->name);
    }

    public function test_templates_and_account_exports_preserve_internal_names(): void
    {
        $this->postJson('/api/v1/link-templates', ['name' => 'Plantilla carta', 'payload' => ['destination' => 'https://example.org/', 'name' => 'Carta reutilizable']])
            ->assertCreated()->assertJsonPath('template.payload.name', 'Carta reutilizable');
        $this->link(['name' => 'Carta exportada']);
        $out = fopen('php://temp', 'w+b');
        self::assertIsResource($out);
        AccountExportDocument::render($this->owner->id, $out);
        rewind($out);
        $document = json_decode(stream_get_contents($out), true, 512, JSON_THROW_ON_ERROR);
        fclose($out);
        self::assertSame('Carta exportada', $document['createdLinks'][0]['name']);
    }

    public function test_api_token_names_obey_write_scope_and_optimistic_versions(): void
    {
        $token = 'fixture-names-api-token';
        $record = ApiToken::create(['workspace_id' => $this->workspace->id, 'created_by' => $this->owner->id, 'name' => 'Names API', 'token_hash' => Ids::sha256Hex($token), 'scopes' => ['links:read', 'links:write']]);
        $created = $this->withHeader('Authorization', 'Bearer '.$token)->withHeader('Idempotency-Key', 'token-name-create-001')
            ->postJson('/api/v1/public/links', ['destination' => 'https://example.org/', 'name' => 'Nombre API'])->assertCreated();
        $id = $created->json('link.id');
        $updated = $this->patchJson('/api/v1/public/links/'.$id, ['version' => $created->json('link.version'), 'name' => 'Nombre cambiado'])->assertOk();
        $updated->assertJsonPath('link.name', 'Nombre cambiado')->assertJsonPath('link.shortUrl', $created->json('link.shortUrl'));
        $this->patchJson('/api/v1/public/links/'.$id, ['version' => $created->json('link.version'), 'name' => 'Stale'])->assertStatus(409);
        $record->update(['scopes' => ['links:read']]);
        $this->patchJson('/api/v1/public/links/'.$id, ['version' => $updated->json('link.version'), 'name' => 'Not allowed'])->assertForbidden();
    }
}
