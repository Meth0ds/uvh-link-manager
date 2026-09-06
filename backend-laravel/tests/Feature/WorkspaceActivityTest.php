<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\WorkspaceActivityCursor;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Prepared only; full PostgreSQL *_test including 000033, no external calls. */
final class WorkspaceActivityTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
    }

    public static function roles(): array
    {
        return [['owner', 200], ['admin', 200], ['editor', 403], ['viewer', 403]];
    }

    #[DataProvider('roles')]
    public function test_role_is_enforced_on_the_server(string $role, int $status): void
    {
        [$owner, $workspace] = $this->fixture();
        $workspace->memberships()->where('user_id', $owner->id)->update(['role' => $role]);
        $this->getJson($this->path($workspace))->assertStatus($status);
    }

    public function test_only_matching_attributed_and_allowlisted_events_are_exposed(): void
    {
        [$owner, $workspace] = $this->fixture();
        $other = $this->workspace($owner);
        $visible = $this->event($workspace->id, $owner->id);
        $this->event($other->id, $owner->id);
        $this->event(null, $owner->id, metadata: ['workspaceId' => $workspace->id]);
        $this->event($workspace->id, $owner->id, 'auth.login', 'user');
        $this->event($workspace->id, $owner->id, 'link.create', 'user');
        $this->event($workspace->id, $owner->id, 'workspace.invite', 'workspace', (string) $other->id);
        $result = $this->withHeader('X-Workspace-Id', (string) $other->id)->getJson($this->path($workspace));
        $result->assertOk()->assertJsonCount(1, 'events')->assertJsonPath('events.0.id', (string) $visible)
            ->assertJsonPath('events.0.actor.label', 'Tú')->assertJsonPath('coverage', 'attributed_events_only')
            ->assertHeader('Cache-Control', 'max-age=0, no-store, private');
        $event = $result->json('events.0');
        $this->assertEqualsCanonicalizing(['id', 'action', 'label', 'outcome', 'actor', 'resource', 'createdAt'], array_keys($event));
        $this->assertStringNotContainsString('private-metadata', $result->getContent());
        $this->assertStringNotContainsString('private-ip-hash', $result->getContent());
        $this->assertStringNotContainsString($owner->email, $result->getContent());
    }

    public function test_keyset_pagination_handles_ties_without_duplicates_when_new_events_arrive(): void
    {
        [$owner, $workspace] = $this->fixture();
        $ids = [];
        for ($i = 0; $i < 5; $i++) {
            $ids[] = $this->event($workspace->id, $owner->id);
        }
        $first = $this->getJson($this->path($workspace, ['limit' => 2]))->assertOk();
        $this->assertSame([(string) $ids[4], (string) $ids[3]], array_column($first->json('events'), 'id'));
        $this->event($workspace->id, $owner->id);
        $second = $this->getJson($this->path($workspace, ['limit' => 2, 'cursor' => $first->json('nextCursor')]))->assertOk();
        $this->assertSame([(string) $ids[2], (string) $ids[1]], array_column($second->json('events'), 'id'));
        $third = $this->getJson($this->path($workspace, ['limit' => 2, 'cursor' => $second->json('nextCursor')]))->assertOk();
        $this->assertSame([(string) $ids[0]], array_column($third->json('events'), 'id'));
        $third->assertJsonPath('nextCursor', null);
        $a = WorkspaceActivityCursor::read($first->json('nextCursor'), $workspace->id, $owner->id, 1);
        $b = WorkspaceActivityCursor::read($second->json('nextCursor'), $workspace->id, $owner->id, 1);
        $this->assertSame($a['expiresAt'], $b['expiresAt']);
    }

    public function test_cursor_cannot_change_workspace_account_or_preserve_revoked_permission(): void
    {
        [$owner, $workspace] = $this->fixture();
        $other = $this->workspace($owner);
        $cursor = $this->cursor($workspace, $owner);
        $this->getJson($this->path($other, ['cursor' => $cursor]))->assertUnprocessable();
        $admin = User::factory()->create();
        $workspace->memberships()->create(['user_id' => $admin->id, 'role' => 'admin']);
        $this->signIn($admin);
        $this->getJson($this->path($workspace, ['cursor' => $cursor]))->assertUnprocessable();
        $this->signIn($owner);
        $workspace->memberships()->where('user_id', $owner->id)->update(['role' => 'viewer']);
        $this->getJson($this->path($workspace, ['cursor' => $cursor]))->assertForbidden();
    }

    public function test_tampered_expired_and_old_security_version_cursors_fail_closed(): void
    {
        [$owner, $workspace] = $this->fixture();
        foreach ([$this->cursor($workspace, $owner).'!', $this->cursor($workspace, $owner, now()->timestamp),
            WorkspaceActivityCursor::issue($workspace->id, $owner->id, 2, '2026-09-05T12:00:00.000000+00:00', '1', now()->timestamp + 60)] as $cursor) {
            $this->getJson($this->path($workspace, ['cursor' => $cursor]))->assertUnprocessable()->assertJsonMissingPath('events');
        }
    }

    public function test_dns_results_do_not_treat_string_true_or_missing_evidence_as_success(): void
    {
        [$owner, $workspace] = $this->fixture();
        foreach ([[true, 'completed'], [false, 'failed'], ['true', 'unknown'], [null, 'unknown']] as [$found, $expected]) {
            $id = $this->event($workspace->id, $owner->id, 'domain.verify', 'domain', metadata: ['found' => $found, 'secret' => 'private-metadata']);
            $this->getJson($this->path($workspace))->assertOk()->assertJsonPath('events.0.id', (string) $id)
                ->assertJsonPath('events.0.outcome', $expected);
        }
    }

    public function test_actor_and_resource_projection_does_not_expose_hidden_identity_or_arbitrary_identifiers(): void
    {
        [$owner, $workspace] = $this->fixture();
        $outsider = User::factory()->create(['name' => 'private-metadata']);
        $this->event($workspace->id, $outsider->id, resourceId: 'https://private.example/token');
        $this->getJson($this->path($workspace))->assertOk()->assertJsonPath('events.0.actor.id', null)
            ->assertJsonPath('events.0.actor.label', 'Actor no disponible')->assertJsonPath('events.0.resource.id', null);
        $this->event($workspace->id, $owner->id, 'admin.link_block');
        $this->getJson($this->path($workspace))->assertOk()->assertJsonPath('events.0.actor.id', null)
            ->assertJsonPath('events.0.actor.label', 'Moderación');
    }

    public function test_missing_session_and_foreign_workspace_are_rejected(): void
    {
        $owner = User::factory()->create();
        $workspace = $this->workspace($owner);
        $this->getJson($this->path($workspace))->assertUnauthorized();
        $this->signIn(User::factory()->create());
        $this->getJson($this->path($workspace))->assertForbidden();
    }

    public static function invalidQueries(): array
    {
        return [[['limit' => 0]], [['limit' => 101]], [['limit' => '1.5']], [['limit' => ['1']]],
            [['cursor' => ['bad']]], [['cursor' => str_repeat('a', 2049)]], [['cursor' => '']]];
    }

    #[DataProvider('invalidQueries')]
    public function test_pagination_inputs_are_bounded(array $query): void
    {
        [, $workspace] = $this->fixture();
        $this->getJson($this->path($workspace, $query))->assertUnprocessable();
    }

    public function test_missing_attribution_schema_returns_safe_unavailable_without_unscoped_fallback(): void
    {
        [, $workspace] = $this->fixture();
        // Transactional PostgreSQL DDL is restored even when an assertion fails.
        DB::beginTransaction();
        try {
            Schema::table('audit_events', fn ($table) => $table->renameColumn('workspace_id', 'activity_test_hidden_workspace'));
            $this->getJson($this->path($workspace))->assertStatus(503)
                ->assertExactJson(['error' => 'No se pudo consultar la actividad. Inténtalo más tarde.']);
        } finally {
            DB::rollBack();
        }
    }

    public function test_account_budget_is_shared_across_workspaces_and_new_sessions(): void
    {
        [$owner, $workspace] = $this->fixture();
        $other = $this->workspace($owner);
        for ($i = 0; $i < 60; $i++) {
            $this->getJson($this->path($i % 2 === 0 ? $workspace : $other))->assertOk();
        }
        $this->signIn($owner);
        $this->getJson($this->path($other))->assertStatus(429)->assertHeader('Retry-After');
    }

    private function fixture(): array
    {
        $owner = User::factory()->create();
        $workspace = $this->workspace($owner);
        $this->signIn($owner);

        return [$owner, $workspace];
    }

    private function workspace(User $owner): Workspace
    {
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Activity', 'slug' => 'activity-'.Ids::randomToken(8)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);

        return $workspace;
    }

    private function signIn(User $user): void
    {
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
    }

    private function event(?int $workspaceId, ?int $actor, string $action = 'link.create', string $type = 'link', string $resourceId = '41', array $metadata = []): int
    {
        return DB::table('audit_events')->insertGetId(['workspace_id' => $workspaceId, 'user_id' => $actor,
            'action' => $action, 'resource_type' => $type, 'resource_id' => $resourceId,
            'metadata' => json_encode($metadata + ['secret' => 'private-metadata'], JSON_THROW_ON_ERROR),
            'ip_hash' => 'private-ip-hash', 'created_at' => '2026-09-05 12:00:00+00']);
    }

    private function cursor(Workspace $workspace, User $user, ?int $expires = null): string
    {
        return WorkspaceActivityCursor::issue($workspace->id, $user->id, (int) $user->security_version,
            '2026-09-05T12:00:00.000000+00:00', '1', $expires ?? now()->timestamp + 3600);
    }

    private function path(Workspace $workspace, array $query = []): string
    {
        return '/api/v1/workspaces/'.$workspace->id.'/activity'.($query === [] ? '' : '?'.http_build_query($query));
    }
}
