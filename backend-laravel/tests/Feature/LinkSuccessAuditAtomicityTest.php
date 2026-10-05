<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Collection;
use App\Models\CustomDomain;
use App\Models\Link;
use App\Models\LinkTemplate;
use App\Models\Tag;
use App\Models\User;
use App\Models\Webhook;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use App\Support\UvhRequest;
use App\Support\WorkspaceWriteActor;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class LinkSuccessAuditAtomicityTest extends TestCase
{
    private const PASSWORD = 'session-write-fixture-password-42';

    private const RECOVERY = 'ABCD2345EFGH6789';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, workspaces, audit_events, audit_outbox, operational_metrics RESTART IDENTITY CASCADE');
        config(['cache.default' => 'array']);
        $this->travelTo(now()->startOfSecond());
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'atomic-csrf')->withHeader('X-CSRF-Token', 'atomic-csrf');
        Queue::fake();
    }

    public static function operations(): array
    {
        return array_map(static fn (string $operation): array => [$operation], [
            'store', 'update', 'state', 'destroy', 'restore', 'appeal', 'purge',
            'bulk-pause', 'bulk-activate', 'bulk-archive', 'bulk-trash', 'bulk-restore',
            'bulk-tag', 'bulk-untag', 'bulk-move', 'bulk-set-domain',
            'tag-rename', 'tag-merge', 'collection-store', 'collection-rename', 'collection-delete', 'template-store', 'template-delete',
        ]);
    }

    #[DataProvider('operations')]
    public function test_specific_admission_failure_rolls_back_business_and_allows_retry(string $operation): void
    {
        $fixture = $this->fixture($operation);
        $before = $this->businessState();
        $this->rejectAction($this->action($operation));
        try {
            $this->mutate($operation, $fixture)->assertServerError();
        } finally {
            $this->removeRejection();
        }
        $this->assertSame($before, $this->businessState());
        $this->assertDatabaseCount('audit_events', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('idempotency_keys', 0);
        Queue::assertNothingPushed();
        $this->mutate($operation, $fixture)->assertStatus($this->successStatus($operation));
        $this->assertSame(1, DB::table('audit_events')->where('action', $this->action($operation))->count());
    }

    #[DataProvider('operations')]
    public function test_interruption_after_specific_insert_rolls_back_and_does_not_strand_a_lease(string $operation): void
    {
        $fixture = $this->fixture($operation);
        $before = $this->businessState();
        $armed = true;
        $hit = false;
        $action = $this->action($operation);
        DB::listen(static function (QueryExecuted $event) use (&$armed, &$hit, $action): void {
            if ($armed && str_starts_with($event->sql, 'insert into "audit_outbox"')
                && json_decode((string) ($event->bindings[0] ?? ''), true)['action'] === $action) {
                $armed = false;
                $hit = true;
                throw new \RuntimeException('Fixture: interrupted after specific audit insert');
            }
        });
        try {
            $this->mutate($operation, $fixture)->assertServerError();
        } finally {
            $armed = false;
        }
        $this->assertTrue($hit);
        $this->assertSame($before, $this->businessState());
        $this->assertDatabaseCount('audit_events', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('idempotency_keys', 0);
        Queue::assertNothingPushed();
        $this->mutate($operation, $fixture)->assertStatus($this->successStatus($operation));
        $this->assertSame(1, DB::table('audit_events')->where('action', $action)->count());
    }

    #[DataProvider('operations')]
    public function test_unavailable_history_preserves_exact_event_until_recovered(string $operation): void
    {
        $fixture = $this->fixture($operation);
        Schema::rename('audit_events', 'audit_events_unavailable');
        try {
            $response = $this->mutate($operation, $fixture)->assertStatus($this->successStatus($operation));
            $events = DB::table('audit_outbox')->pluck('event')->map(static fn ($event): array => json_decode($event, true, flags: JSON_THROW_ON_ERROR));
            $event = $events->where('action', $this->action($operation))->sole();
            $this->assertExactEvent($operation, $fixture, $response, $event);
        } finally {
            Schema::rename('audit_events_unavailable', 'audit_events');
        }
        $this->assertTrue(Audit::drain());
        $this->assertTrue(Audit::drain());
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertSame(1, DB::table('audit_events')->where('action', $this->action($operation))->count());
        if (str_starts_with($operation, 'bulk-')) {
            $before = $this->businessState();
            $this->mutate($operation, $fixture)->assertOk()->assertHeader('Idempotent-Replay', 'true');
            $this->assertSame($before, $this->businessState());
            $this->assertSame(1, DB::table('audit_events')->where('action', 'link.bulk')->count());
        }
    }

    public function test_csv_summary_admission_failure_keeps_rows_but_does_not_seal_an_unaudited_ack(): void
    {
        $fixture = $this->fixture('csv-import');
        $this->rejectAction('link.import');
        try {
            $this->mutate('csv-import', $fixture)->assertServerError();
        } finally {
            $this->removeRejection();
        }
        $this->assertDatabaseCount('link_import_rows', 2);
        $this->assertSame(2, Link::where('alias', 'like', 'atomic-%')->count());
        $this->assertDatabaseCount('idempotency_keys', 0);
        $this->assertSame(0, DB::table('audit_events')->where('action', 'link.import')->count());
        $this->retryCsv($fixture);
    }

    public function test_csv_summary_interruption_preserves_retryable_rows_without_a_sealed_ack(): void
    {
        $fixture = $this->fixture('csv-import');
        $armed = true;
        $hit = false;
        DB::listen(static function (QueryExecuted $event) use (&$armed, &$hit): void {
            if ($armed && str_starts_with($event->sql, 'insert into "audit_outbox"')
                && json_decode((string) ($event->bindings[0] ?? ''), true)['action'] === 'link.import') {
                $armed = false;
                $hit = true;
                throw new \RuntimeException('Fixture: interrupted after CSV summary audit insert');
            }
        });
        try {
            $this->mutate('csv-import', $fixture)->assertServerError();
        } finally {
            $armed = false;
        }
        $this->assertTrue($hit);
        $this->assertDatabaseCount('link_import_rows', 2);
        $this->assertSame(2, Link::where('alias', 'like', 'atomic-%')->count());
        $this->assertDatabaseCount('idempotency_keys', 0);
        $this->assertSame(0, DB::table('audit_events')->where('action', 'link.import')->count());
        $this->retryCsv($fixture);
    }

    public function test_csv_history_failure_keeps_one_summary_for_recovery_and_replays(): void
    {
        $fixture = $this->fixture('csv-import');
        Schema::rename('audit_events', 'audit_events_unavailable');
        try {
            $response = $this->mutate('csv-import', $fixture)->assertOk()->assertJsonPath('created', 2);
            $events = DB::table('audit_outbox')->pluck('event')->map(static fn ($event): array => json_decode($event, true, flags: JSON_THROW_ON_ERROR));
            $this->assertExactEvent('csv-import', $fixture, $response, $events->where('action', 'link.import')->sole());
            $this->mutate('csv-import', $fixture)->assertOk()->assertHeader('Idempotent-Replay', 'true');
            $this->assertSame(1, DB::table('audit_outbox')->whereRaw("event::jsonb->>'action' = ?", ['link.import'])->count());
        } finally {
            Schema::rename('audit_events_unavailable', 'audit_events');
        }
        $this->assertTrue(Audit::drain());
        $this->assertTrue(Audit::drain());
        $this->assertSame(1, DB::table('audit_events')->where('action', 'link.import')->count());
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('link_import_rows', 2);
    }

    #[DataProvider('operations')]
    public function test_outer_rollback_discards_business_and_both_specific_and_generic_events(string $operation): void
    {
        $fixture = $this->fixture($operation);
        $before = $this->businessState();
        DB::beginTransaction();
        try {
            $this->mutate($operation, $fixture)->assertStatus($this->successStatus($operation));
            $this->assertSame(0, DB::table('audit_events')->count());
            $this->assertSame(1, DB::table('audit_outbox')->whereRaw("event::jsonb->>'action' = ?", [$this->action($operation)])->count());
        } finally {
            DB::rollBack();
        }
        $this->assertSame($before, $this->businessState());
        DB::transaction(static fn () => DB::select('SELECT 1'));
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('audit_events', 0);
        $this->assertDatabaseCount('idempotency_keys', 0);
        // Queue transport for internal/nested callers is a separate gate;
        // this test establishes SQL/outbox atomicity only.
    }

    public static function bearerOperations(): array
    {
        return [['store'], ['update'], ['state'], ['destroy'], ['restore']];
    }

    #[DataProvider('bearerOperations')]
    public function test_public_api_failure_rolls_back_and_history_recovery_keeps_native_attribution(string $operation): void
    {
        $fixture = $this->fixture($operation, false);
        $token = 'atomic-native-api-token';
        ApiToken::create([
            'workspace_id' => $fixture['workspace']->id, 'created_by' => $fixture['user']->id,
            'name' => 'Audit API', 'token_hash' => Ids::sha256Hex($token), 'scopes' => ['links:read', 'links:write'],
        ]);
        $this->defaultCookies = [];
        $this->withHeader('Authorization', 'Bearer '.$token);
        $before = $this->businessState();
        $this->rejectAction($this->action($operation));
        try {
            $this->mutate($operation, $fixture, publicApi: true)->assertServerError();
        } finally {
            $this->removeRejection();
        }
        $this->assertSame($before, $this->businessState());
        Queue::assertNothingPushed();
        Schema::rename('audit_events', 'audit_events_unavailable');
        try {
            $response = $this->mutate($operation, $fixture, publicApi: true)->assertStatus($this->successStatus($operation));
            $events = DB::table('audit_outbox')->pluck('event')->map(static fn ($event): array => json_decode($event, true, flags: JSON_THROW_ON_ERROR));
            $event = $events->where('action', $this->action($operation))->sole();
            $this->assertExactEvent($operation, $fixture, $response, $event);
            $this->assertStringNotContainsString($token, json_encode($event, JSON_THROW_ON_ERROR));
        } finally {
            Schema::rename('audit_events_unavailable', 'audit_events');
        }
        $this->assertTrue(Audit::drain());
        $this->assertTrue(Audit::drain());
        $this->assertSame(1, DB::table('audit_events')->where('action', $this->action($operation))->count());
    }

    public function test_link_audit_capture_refuses_outside_a_business_transaction(): void
    {
        $fixture = $this->fixture('state');
        $request = Request::create('/');
        $request->attributes->set(UvhRequest::USER, $fixture['user']);
        $request->attributes->set(UvhRequest::WORKSPACE_ID, (int) $fixture['workspace']->id);
        $actor = WorkspaceWriteActor::fromRequest($request);
        $this->expectException(\LogicException::class);
        $actor->auditLink('link.state_change', (int) $fixture['active']->id);
    }

    private function rejectAction(string $action): void
    {
        // This runs only after TestCase's testing/*_test guards. The real
        // PostgreSQL trigger refuses only this event; generic events still work.
        DB::unprepared(<<<'SQL'
            CREATE FUNCTION uvh_test_reject_link_audit() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF NEW.event::jsonb->>'action' = TG_ARGV[0] THEN
                    RAISE EXCEPTION 'Fixture: specific audit admission unavailable' USING ERRCODE = '58000';
                END IF;
                RETURN NEW;
            END $$
            SQL);
        DB::unprepared("CREATE TRIGGER uvh_test_reject_link_audit BEFORE INSERT ON audit_outbox FOR EACH ROW EXECUTE FUNCTION uvh_test_reject_link_audit('".$action."')");
    }

    private function removeRejection(): void
    {
        DB::unprepared('DROP FUNCTION uvh_test_reject_link_audit() CASCADE');
    }

    private function retryCsv(array $fixture): void
    {
        $this->mutate('csv-import', $fixture)->assertOk()->assertJson(['created' => 2, 'valid' => 2, 'errors' => []]);
        $this->assertDatabaseCount('link_import_rows', 2);
        $this->assertSame(2, Link::where('alias', 'like', 'atomic-%')->count());
        $this->assertSame(1, DB::table('audit_events')->where('action', 'link.import')->count());
        $before = $this->businessState();
        $this->mutate('csv-import', $fixture)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertSame($before, $this->businessState());
    }

    private function action(string $operation): string
    {
        return str_starts_with($operation, 'bulk-') ? 'link.bulk' : match ($operation) {
            'store' => 'link.create', 'update' => 'link.update', 'state' => 'link.state_change',
            'destroy' => 'link.delete', 'restore' => 'link.restore', 'appeal' => 'link.appeal', 'purge' => 'link.purge',
            'tag-rename' => 'tag.rename', 'tag-merge' => 'tag.merge',
            'collection-store' => 'collection.create', 'collection-rename' => 'collection.rename', 'collection-delete' => 'collection.delete',
            'template-store' => 'link_template.create', 'template-delete' => 'link_template.delete', 'csv-import' => 'link.import',
        };
    }

    private function successStatus(string $operation): int
    {
        return in_array($operation, ['store', 'appeal', 'collection-store', 'template-store'], true) ? 201 : 200;
    }

    private function assertExactEvent(string $operation, array $fixture, TestResponse $response, array $event): void
    {
        $type = str_starts_with($operation, 'collection-') ? 'collection' : (str_starts_with($operation, 'template-') ? 'link_template' : (str_starts_with($operation, 'tag-') ? 'tag' : 'link'));
        $id = match ($operation) {
            'store' => $response->json('link.id'),
            'collection-store' => $response->json('collection.id'),
            'template-store' => $response->json('template.id'),
            'collection-rename', 'collection-delete' => $fixture['collection']->id,
            'template-delete' => $fixture['template']->id,
            'tag-rename' => $fixture['tag']->id,
            'tag-merge' => $fixture['target']->id,
            'restore', 'purge' => $fixture['trashed']->id,
            'appeal' => $fixture['blocked']->id,
            default => str_starts_with($operation, 'bulk-') || $operation === 'csv-import' ? null : $fixture['active']->id,
        };
        $this->assertSame($fixture['user']->id, $event['user_id']);
        $this->assertSame($fixture['workspace']->id, $event['workspace_id']);
        $this->assertSame($type, $event['resource_type']);
        $this->assertSame($id === null ? null : (string) $id, $event['resource_id']);
        $this->assertSame(UvhCrypto::hashIp('127.0.0.1'), $event['ip_hash']);
        $metadata = json_decode($event['metadata'] ?? '{}', true, flags: JSON_THROW_ON_ERROR);
        $this->assertArrayHasKey('correlation_id', $metadata);
        unset($metadata['correlation_id']);
        $expected = match ($operation) {
            'state' => ['from' => 'active', 'to' => 'paused', 'reason' => null],
            'appeal' => ['appealId' => $response->json('appealId')],
            'purge' => ['alias' => $fixture['trashed']->alias, 'factor' => 'recovery'],
            'tag-rename' => ['from' => 'Existing', 'to' => 'Changed'],
            'tag-merge' => ['sourceIds' => [(int) $fixture['tag']->id], 'moved' => 0],
            'collection-store', 'collection-rename', 'template-store' => ['name' => 'Changed'],
            'collection-delete' => ['moved' => 1, 'cleared_templates' => 1],
            'csv-import' => ['created' => 2, 'failed' => 0, 'invalid' => 0],
            default => str_starts_with($operation, 'bulk-') ? ['action' => substr($operation, 5), 'count' => 1, 'linkIds' => [(int) ($operation === 'bulk-restore' ? $fixture['trashed']->id : $fixture['active']->id)]] : [],
        };
        $this->assertSame($expected, $metadata);
        $serialized = json_encode($event, JSON_THROW_ON_ERROR);
        foreach ([self::PASSWORD, self::RECOVERY, $fixture['token'], 'fixture-secret', 'https://example.org/new'] as $secret) {
            $this->assertStringNotContainsString($secret, $serialized);
        }
    }

    private function fixture(string $operation, bool $mfa = true): array
    {
        $user = User::factory()->create([
            'email_verified_at' => now(), 'password_hash' => Hash::make(self::PASSWORD),
            'mfa_enabled' => $mfa, 'mfa_secret' => $mfa ? UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP') : null,
            'recovery_codes' => $mfa ? [Ids::sha256Hex(self::RECOVERY)] : [],
        ]);
        $other = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $user->ownedWorkspaces()->create(['name' => 'Link authority', 'slug' => 'link-authority']);
        $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);
        $collection = Collection::create(['workspace_id' => $workspace->id, 'name' => 'Collection']);
        $tag = Tag::create(['workspace_id' => $workspace->id, 'name' => 'Existing']);
        $domain = CustomDomain::create([
            'workspace_id' => $workspace->id, 'domain' => 'go.example.test',
            'verification_token' => 'uvh-verify=SessionFixture', 'verification_version' => 1, 'verification_scheme' => 2,
            'ownership_status' => 'verified', 'routing_status' => 'healthy', 'tls_status' => 'ready',
            'verified_at' => now(), 'ownership_verified_at' => now(), 'routing_verified_at' => now(),
            'desired_state' => 'enabled', 'edge_eligible' => true, 'tls_ready_at' => now(),
        ]);
        $active = Link::create([
            'workspace_id' => $workspace->id, 'created_by' => $user->id, 'alias' => 'session-active',
            'destination' => 'https://example.org', 'state' => $operation === 'bulk-activate' ? 'paused' : 'active', 'version' => 1,
        ]);
        $target = Tag::create(['workspace_id' => $workspace->id, 'name' => 'Target']);
        $template = LinkTemplate::create(['workspace_id' => $workspace->id, 'created_by' => $user->id, 'name' => 'Template', 'payload' => ['destination' => 'https://example.org', 'collection_id' => (int) $collection->id]]);
        $active->update(['collection_id' => $operation === 'bulk-move' ? null : $collection->id]);
        $active->tags()->attach([$tag->id, $target->id]);
        $trashed = Link::create([
            'workspace_id' => $workspace->id, 'created_by' => $user->id, 'alias' => 'session-trashed',
            'destination' => 'https://example.org', 'state' => 'deleted', 'state_before_delete' => 'active',
            'deleted_at' => now(), 'version' => 2,
        ]);
        $blocked = Link::create([
            'workspace_id' => $workspace->id, 'created_by' => $user->id, 'alias' => 'session-blocked',
            'destination' => 'https://example.org', 'state' => 'blocked', 'version' => 1,
        ]);
        Webhook::create([
            'workspace_id' => $workspace->id, 'created_by' => $user->id, 'url' => 'https://example.org/hook',
            'secret' => 'fixture-secret', 'events' => ['link.created', 'link.updated', 'link.deleted'], 'active' => true,
        ]);
        $token = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true);
        $otherToken = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true);
        $sessionId = Ids::sha256Hex($token);
        $otherSessionId = Ids::sha256Hex($otherToken);
        $this->withCookie((string) config('uvh.session_cookie'), $token)->withHeader('X-Workspace-Id', (string) $workspace->id);

        return compact('user', 'other', 'workspace', 'active', 'trashed', 'blocked', 'collection', 'domain', 'tag', 'target', 'template', 'token', 'sessionId', 'otherSessionId');
    }

    private function mutate(string $operation, array $fixture, string $factor = 'recovery', bool $publicApi = false): TestResponse
    {
        if (str_starts_with($operation, 'bulk-')) {
            $action = substr($operation, 5);
            $link = $action === 'restore' ? $fixture['trashed'] : $fixture['active'];
            $body = ['action' => $action, 'linkIds' => [(int) $link->id]];
            if ($action === 'tag' || $action === 'untag') {
                $body['tags'] = [$action === 'tag' ? 'Added' : 'Existing'];
            }
            if ($action === 'move') {
                $body['collectionId'] = (int) $fixture['collection']->id;
            }
            if ($action === 'set-domain') {
                $body['domainId'] = (int) $fixture['domain']->id;
            }

            return $this->postJson('/api/v1/links/bulk', $body, ['Idempotency-Key' => 'session-'.$operation]);
        }

        $base = $publicApi ? '/api/v1/public/links' : '/api/v1/links';

        return match ($operation) {
            'tag-rename' => $this->postJson('/api/v1/tags/'.$fixture['tag']->id.'/rename', ['name' => 'Changed']),
            'tag-merge' => $this->postJson('/api/v1/tags/merge', ['sourceIds' => [(int) $fixture['tag']->id], 'targetId' => (int) $fixture['target']->id]),
            'collection-store' => $this->postJson('/api/v1/collections', ['name' => 'Changed']),
            'collection-rename' => $this->patchJson('/api/v1/collections/'.$fixture['collection']->id, ['name' => 'Changed']),
            'collection-delete' => $this->deleteJson('/api/v1/collections/'.$fixture['collection']->id),
            'template-store' => $this->postJson('/api/v1/link-templates', ['name' => 'Changed', 'payload' => ['destination' => 'https://example.org/new']]),
            'template-delete' => $this->deleteJson('/api/v1/link-templates/'.$fixture['template']->id),
            'csv-import' => $this->postJson('/api/v1/links/import', ['dryRun' => false, 'csv' => "alias,destination\natomic-one,https://example.org/1\natomic-two,https://example.org/2\n"], ['Idempotency-Key' => 'atomic-import']),
            'store' => $this->postJson($base, ['alias' => 'session-new', 'destination' => 'https://example.org/new']),
            'update' => $this->patchJson($base.'/'.$fixture['active']->id, ['version' => 1, 'destination' => 'https://example.org/new']),
            'state' => $this->postJson($base.'/'.$fixture['active']->id.'/state', ['state' => 'paused']),
            'destroy' => $this->deleteJson($base.'/'.$fixture['active']->id),
            'restore' => $this->postJson($base.'/'.$fixture['trashed']->id.'/restore'),
            'appeal' => $this->postJson('/api/v1/links/'.$fixture['blocked']->id.'/appeal', ['message' => 'Please review']),
            'purge' => $this->postJson('/api/v1/links/'.$fixture['trashed']->id.'/purge', [
                'password' => self::PASSWORD, 'factorCode' => $factor === 'recovery' ? self::RECOVERY : '',
                'confirmation' => 'ELIMINAR '.$fixture['trashed']->alias,
            ]),
        };
    }

    private function businessState(): array
    {
        $state = [];
        foreach (['links', 'collections', 'tags', 'link_templates', 'redirect_rules', 'link_appeals', 'webhook_deliveries', 'link_import_batches', 'link_import_rows'] as $table) {
            $state[$table] = DB::table($table)->orderBy('id')->get()->map(static fn ($row): array => (array) $row)->all();
        }
        $state['link_tags'] = DB::table('link_tags')->orderBy('link_id')->orderBy('tag_id')->get()->map(static fn ($row): array => (array) $row)->all();
        $state['recovery'] = DB::table('users')->orderBy('id')->pluck('recovery_codes')->all();

        return $state;
    }
}
