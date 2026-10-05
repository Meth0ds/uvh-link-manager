<?php

namespace Tests\Feature;

use App\Models\Collection;
use App\Models\Link;
use App\Models\LinkTemplate;
use App\Models\Tag;
use App\Models\User;
use App\Models\Webhook;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class WorkspaceMutationSessionTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, workspaces, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        config(['cache.default' => 'array']);
        $this->travelTo(now()->startOfSecond());
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'mutation-session-csrf')->withHeader('X-CSRF-Token', 'mutation-session-csrf');
        Queue::fake();
    }

    public static function operations(): array
    {
        return array_map(static fn (string $operation): array => [$operation], [
            'tag-rename', 'tag-merge', 'collection-store', 'collection-rename', 'collection-delete',
            'template-store', 'template-delete', 'csv-import',
        ]);
    }

    public static function invalidSessions(): array
    {
        $cases = [];
        foreach (self::operations() as [$operation]) {
            foreach (['revoked', 'expired', 'generation', 'foreign', 'missing'] as $change) {
                $cases[$operation.' '.$change] = [$operation, $change];
            }
        }

        return $cases;
    }

    #[DataProvider('invalidSessions')]
    public function test_exact_session_is_rechecked_after_middleware_before_writing(string $operation, string $change): void
    {
        $fixture = $this->fixture();
        $before = $this->businessState();
        $armed = true;
        $intercepted = false;
        DB::listen(static function (QueryExecuted $event) use (&$armed, &$intercepted, $fixture, $change): void {
            if (! $armed || ! str_starts_with($event->sql, 'select * from "users"') || ! str_contains($event->sql, 'for update')) {
                return;
            }
            $armed = false;
            $intercepted = true;
            $query = DB::table('sessions')->where('id', $fixture['sessionId']);
            match ($change) {
                'revoked' => $query->update(['revoked_at' => now()]),
                'expired' => $query->update(['expires_at' => now()]),
                'generation' => $query->update(['security_version' => 2]),
                'foreign' => $query->update(['user_id' => $fixture['other']->id]),
                'missing' => $query->delete(),
            };
        });
        try {
            $response = $this->mutate($operation, $fixture);
        } finally {
            $armed = false;
        }
        $this->assertTrue($intercepted, 'Invalidate only after session hydration and before the business lock');
        $response->assertForbidden();
        $this->assertSame($before, $this->businessState());
        $this->assertDatabaseCount('idempotency_keys', 0);
        $this->assertDatabaseHas('sessions', ['id' => $fixture['otherSessionId'], 'revoked_at' => null]);
        Queue::assertNothingPushed();
    }

    #[DataProvider('operations')]
    public function test_live_exact_session_preserves_each_operation(string $operation): void
    {
        $fixture = $this->fixture();
        $before = $this->businessState();
        $this->mutate($operation, $fixture)->assertStatus(in_array($operation, ['collection-store', 'template-store'], true) ? 201 : 200);
        $this->assertNotSame($before, $this->businessState());
        $this->assertGreaterThan(0, DB::table('audit_events')->where('action', 'workspace.mutation_committed')->count());
    }

    public function test_csv_stops_between_committed_rows_and_a_new_session_can_resume_the_same_intention(): void
    {
        $fixture = $this->fixture();
        $armed = true;
        $intercepted = false;
        DB::listen(static function (QueryExecuted $event) use (&$armed, &$intercepted, $fixture): void {
            if (! $armed || ! str_starts_with(strtolower($event->sql), 'insert into "link_import_rows"')) {
                return;
            }
            $armed = false;
            DB::afterCommit(static function () use (&$intercepted, $fixture): void {
                $intercepted = true;
                SessionManager::revoke($fixture['sessionId']);
            });
        });
        try {
            $response = $this->mutate('csv-import', $fixture);
        } finally {
            $armed = false;
        }
        $this->assertTrue($intercepted, 'Revoke after the first row commits, before the next transaction');
        $response->assertForbidden();
        $this->assertSame(['session-row-one'], Link::where('alias', 'like', 'session-row-%')->orderBy('alias')->pluck('alias')->all());
        $this->assertDatabaseCount('link_import_rows', 1);
        $this->assertDatabaseCount('idempotency_keys', 0);
        $this->withCookie((string) config('uvh.session_cookie'), $fixture['otherSessionToken']);
        $this->mutate('csv-import', $fixture)->assertOk()->assertJson(['created' => 2, 'valid' => 2, 'errors' => []]);
        $this->assertDatabaseCount('link_import_rows', 2);
        $this->assertSame(['session-row-one', 'session-row-two'], Link::where('alias', 'like', 'session-row-%')->orderBy('alias')->pluck('alias')->all());
        $this->mutate('csv-import', $fixture)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertDatabaseCount('link_import_rows', 2);
    }

    private function fixture(): array
    {
        $user = User::factory()->create(['email_verified_at' => now()]);
        $other = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $user->ownedWorkspaces()->create(['name' => 'Session authority', 'slug' => 'session-authority']);
        $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
        $collection = Collection::create(['workspace_id' => $workspace->id, 'name' => 'Collection']);
        $source = Tag::create(['workspace_id' => $workspace->id, 'name' => 'Source']);
        $target = Tag::create(['workspace_id' => $workspace->id, 'name' => 'Target']);
        $template = LinkTemplate::create([
            'workspace_id' => $workspace->id, 'created_by' => $user->id, 'name' => 'Template',
            'payload' => ['destination' => 'https://example.org', 'collection_id' => (int) $collection->id],
        ]);
        $link = Link::create([
            'workspace_id' => $workspace->id, 'created_by' => $user->id, 'collection_id' => $collection->id,
            'alias' => 'session-linked', 'destination' => 'https://example.org', 'state' => 'active', 'version' => 1,
        ]);
        $link->tags()->attach([$source->id, $target->id]);
        Webhook::create([
            'workspace_id' => $workspace->id, 'created_by' => $user->id, 'url' => 'https://example.org/hook',
            'secret' => 'fixture-secret', 'events' => ['link.updated', 'link.created'], 'active' => true,
        ]);
        $token = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version);
        $otherSessionToken = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version);
        $sessionId = Ids::sha256Hex($token);
        $otherSessionId = Ids::sha256Hex($otherSessionToken);
        $this->withCookie((string) config('uvh.session_cookie'), $token)->withHeader('X-Workspace-Id', (string) $workspace->id);

        return compact('user', 'other', 'workspace', 'collection', 'source', 'target', 'template', 'sessionId', 'otherSessionId', 'otherSessionToken');
    }

    private function mutate(string $operation, array $fixture): TestResponse
    {
        return match ($operation) {
            'tag-rename' => $this->postJson('/api/v1/tags/'.$fixture['source']->id.'/rename', ['name' => 'Changed']),
            'tag-merge' => $this->postJson('/api/v1/tags/merge', ['sourceIds' => [(int) $fixture['source']->id], 'targetId' => (int) $fixture['target']->id]),
            'collection-store' => $this->postJson('/api/v1/collections', ['name' => 'Changed']),
            'collection-rename' => $this->patchJson('/api/v1/collections/'.$fixture['collection']->id, ['name' => 'Changed']),
            'collection-delete' => $this->deleteJson('/api/v1/collections/'.$fixture['collection']->id),
            'template-store' => $this->postJson('/api/v1/link-templates', ['name' => 'Changed', 'payload' => ['destination' => 'https://example.org/new']]),
            'template-delete' => $this->deleteJson('/api/v1/link-templates/'.$fixture['template']->id),
            'csv-import' => $this->postJson('/api/v1/links/import', [
                'dryRun' => false, 'csv' => "alias,destination\nsession-row-one,https://example.org/1\nsession-row-two,https://example.org/2\n",
            ], ['Idempotency-Key' => 'session-import']),
        };
    }

    private function businessState(): array
    {
        $state = [];
        foreach (['collections', 'tags', 'links', 'link_templates', 'webhook_deliveries', 'link_import_batches', 'link_import_rows', 'audit_outbox', 'audit_events'] as $table) {
            $state[$table] = DB::table($table)->orderBy('id')->get()->map(static fn ($row): array => (array) $row)->all();
        }
        $state['link_tags'] = DB::table('link_tags')->orderBy('link_id')->orderBy('tag_id')->get()->map(static fn ($row): array => (array) $row)->all();

        return $state;
    }
}
