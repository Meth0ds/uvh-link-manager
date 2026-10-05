<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Collection;
use App\Models\CustomDomain;
use App\Models\Link;
use App\Models\Tag;
use App\Models\User;
use App\Models\Webhook;
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
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class LinkWriteSessionAuthorityTest extends TestCase
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
        $this->withCookie('uvh_csrf', 'link-session-csrf')->withHeader('X-CSRF-Token', 'link-session-csrf');
        Queue::fake();
    }

    public static function operations(): array
    {
        return array_map(static fn (string $operation): array => [$operation], [
            'store', 'update', 'state', 'destroy', 'restore', 'appeal', 'purge',
            'bulk-pause', 'bulk-activate', 'bulk-archive', 'bulk-trash', 'bulk-restore',
            'bulk-tag', 'bulk-untag', 'bulk-move', 'bulk-set-domain',
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

    public static function purgeDeadlines(): array
    {
        $cases = [];
        foreach (['password', 'recovery'] as $factor) {
            foreach ([-1, 0, 1] as $seconds) {
                $cases[$factor.' '.$seconds] = [$factor, $seconds];
            }
        }

        return $cases;
    }

    public static function bearerOperations(): array
    {
        return [['store'], ['update'], ['state'], ['destroy'], ['restore']];
    }

    public static function bearerChanges(): array
    {
        $cases = [];
        foreach (self::bearerOperations() as [$operation]) {
            foreach (['revoked', 'expired', 'scope', 'role', 'generation'] as $change) {
                $cases[$operation.' '.$change] = [$operation, $change];
            }
        }

        return $cases;
    }

    #[DataProvider('invalidSessions')]
    public function test_authenticated_request_rechecks_its_exact_session_before_link_writes(string $operation, string $change): void
    {
        $fixture = $this->fixture($operation);
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
        $this->assertTrue($intercepted, 'Invalidate the exact SQL session after middleware, before business authority');
        $response->assertStatus($operation === 'purge' ? 409 : 403);
        $this->assertSame($before, $this->businessState());
        $this->assertDatabaseCount('idempotency_keys', 0);
        $this->assertDatabaseHas('sessions', ['id' => $fixture['otherSessionId'], 'revoked_at' => null]);
        Queue::assertNothingPushed();
    }

    #[DataProvider('operations')]
    public function test_current_session_preserves_the_valid_business_operation(string $operation): void
    {
        $fixture = $this->fixture($operation);
        $before = $this->businessState();
        $locks = ['users' => 0, 'sessions' => 0];
        DB::listen(static function (QueryExecuted $event) use (&$locks): void {
            foreach (array_keys($locks) as $table) {
                if (str_starts_with($event->sql, 'select * from "'.$table.'"') && str_contains($event->sql, 'for update')) {
                    $locks[$table]++;
                }
            }
        });
        $this->mutate($operation, $fixture)->assertStatus(in_array($operation, ['store', 'appeal'], true) ? 201 : 200);
        $this->assertNotSame($before, $this->businessState());
        $this->assertGreaterThan(0, DB::table('audit_events')->count());
        $this->assertSame(['users' => 1, 'sessions' => 1], $locks);
    }

    #[DataProvider('purgeDeadlines')]
    public function test_purge_deadline_is_checked_before_password_or_recovery_consumption(string $factor, int $seconds): void
    {
        $fixture = $this->fixture('purge', $factor === 'recovery');
        $before = $this->businessState();
        $armed = true;
        $intercepted = false;
        DB::listen(static function (QueryExecuted $event) use (&$armed, &$intercepted, $fixture, $seconds): void {
            if ($armed && str_starts_with($event->sql, 'select * from "users"') && str_contains($event->sql, 'for update')) {
                $armed = false;
                $intercepted = true;
                DB::table('sessions')->where('id', $fixture['sessionId'])->update(['expires_at' => now()->addSeconds($seconds)]);
            }
        });
        try {
            $response = $this->mutate('purge', $fixture, $factor);
        } finally {
            $armed = false;
        }
        $this->assertTrue($intercepted);
        if ($seconds <= 0) {
            $response->assertStatus(409);
            $this->assertSame($before, $this->businessState());
            Queue::assertNothingPushed();
        } else {
            $response->assertOk();
            $this->assertDatabaseMissing('links', ['id' => $fixture['trashed']->id]);
            if ($factor === 'recovery') {
                $this->assertSame([], $fixture['user']->fresh()->recovery_codes);
            }
        }
    }

    #[DataProvider('bearerOperations')]
    public function test_bearer_writes_need_no_browser_session_and_ignore_an_unrelated_cookie(string $operation): void
    {
        $fixture = $this->fixture($operation);
        $this->bearer($fixture);
        $this->withCookie((string) config('uvh.session_cookie'), '');
        $sessionLocks = 0;
        DB::listen(static function (QueryExecuted $event) use (&$sessionLocks): void {
            if (str_starts_with($event->sql, 'select * from "sessions"') && str_contains($event->sql, 'for update')) {
                $sessionLocks++;
            }
        });
        $this->mutate($operation, $fixture, publicApi: true)->assertStatus($operation === 'store' ? 201 : 200);
        $this->assertSame(0, $sessionLocks, 'Bearer authority does not depend on a browser session');
        $unrelated = SessionManager::create($fixture['other']->id, Request::create('/'), (int) $fixture['other']->security_version);
        $this->withCookie((string) config('uvh.session_cookie'), $unrelated);
        $this->patchJson('/api/v1/public/links/'.$fixture['active']->id, [
            'version' => (int) $fixture['active']->fresh()?->version, 'destination' => 'https://example.org/bearer-cookie',
        ])->assertStatus($operation === 'destroy' ? 404 : 200);
        $this->assertSame(0, $sessionLocks);
        $this->assertDatabaseHas('links', ['id' => $fixture['trashed']->id, 'workspace_id' => $fixture['workspace']->id]);
    }

    #[DataProvider('bearerChanges')]
    public function test_bearer_snapshot_rechecks_token_scope_role_and_account_before_writing(string $operation, string $change): void
    {
        $fixture = $this->fixture($operation);
        $apiToken = $this->bearer($fixture);
        $before = $this->businessState();
        $armed = true;
        $intercepted = false;
        DB::connection()->beforeExecuting(static function (string $sql) use (&$armed, &$intercepted, $fixture, $apiToken, $change): void {
            if ($armed && str_starts_with($sql, 'select * from "users"') && str_contains($sql, 'for update')) {
                $armed = false;
                $intercepted = true;
                match ($change) {
                    'revoked' => ApiToken::where('id', $apiToken->id)->update(['revoked_at' => now()]),
                    'expired' => ApiToken::where('id', $apiToken->id)->update(['expires_at' => now()->subSecond()]),
                    'scope' => ApiToken::where('id', $apiToken->id)->update(['scopes' => ['links:read']]),
                    'role' => DB::table('memberships')->where('user_id', $fixture['user']->id)->update(['role' => 'viewer']),
                    'generation' => User::where('id', $fixture['user']->id)->increment('security_version'),
                };
            }
        });
        try {
            $response = $this->mutate($operation, $fixture, publicApi: true);
        } finally {
            $armed = false;
        }
        $this->assertTrue($intercepted, 'Invalidate after RequireApiToken admits the request');
        $response->assertForbidden();
        $this->assertSame($before, $this->businessState());
        Queue::assertNothingPushed();
    }

    public function test_captured_actor_cannot_be_reused_for_another_user_workspace_or_generation(): void
    {
        $fixture = $this->fixture('state');
        $request = Request::create('/');
        $request->attributes->set(UvhRequest::USER, $fixture['user']);
        $request->attributes->set(UvhRequest::WORKSPACE_ID, (int) $fixture['workspace']->id);
        $request->attributes->set(UvhRequest::SESSION_ID, $fixture['sessionId']);
        $actor = WorkspaceWriteActor::fromRequest($request);
        $fixture['user']->security_version = 2; // The request model is mutable, the captured version is not.
        DB::transaction(function () use ($actor, $fixture): void {
            $this->assertNull($actor->lockMembership($fixture['other']->id, $fixture['workspace']->id));
            $this->assertNull($actor->lockMembership($fixture['user']->id, $fixture['workspace']->id + 1));
            $this->assertNull($actor->lockMembership($fixture['user']->id, $fixture['workspace']->id, 2));
            $this->assertNotNull($actor->lockMembership($fixture['user']->id, $fixture['workspace']->id, 1));
        });
    }

    public function test_captured_actor_requires_the_business_transaction_to_authorize(): void
    {
        $fixture = $this->fixture('state');
        $request = Request::create('/');
        $request->attributes->set(UvhRequest::USER, $fixture['user']);
        $request->attributes->set(UvhRequest::WORKSPACE_ID, (int) $fixture['workspace']->id);
        $request->attributes->set(UvhRequest::SESSION_ID, $fixture['sessionId']);
        $actor = WorkspaceWriteActor::fromRequest($request);
        $this->expectException(\LogicException::class);
        $actor->lockMembership($fixture['user']->id, $fixture['workspace']->id);
    }

    private function bearer(array $fixture): ApiToken
    {
        $token = ApiToken::create([
            'workspace_id' => $fixture['workspace']->id, 'created_by' => $fixture['user']->id,
            'name' => 'write fixture', 'token_hash' => Ids::sha256Hex('fixture-write-token'),
            'scopes' => ['links:read', 'links:write'],
        ]);
        $this->withHeader('Authorization', 'Bearer fixture-write-token');

        return $token;
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
        $active->tags()->attach($tag->id);
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

        return compact('user', 'other', 'workspace', 'active', 'trashed', 'blocked', 'collection', 'domain', 'sessionId', 'otherSessionId');
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
        foreach (['links', 'collections', 'tags', 'redirect_rules', 'link_appeals', 'webhook_deliveries', 'audit_outbox', 'audit_events'] as $table) {
            $state[$table] = DB::table($table)->orderBy('id')->get()->map(static fn ($row): array => (array) $row)->all();
        }
        $state['link_tags'] = DB::table('link_tags')->orderBy('link_id')->orderBy('tag_id')->get()->map(static fn ($row): array => (array) $row)->all();
        $state['recovery'] = DB::table('users')->orderBy('id')->pluck('recovery_codes')->all();

        return $state;
    }
}
