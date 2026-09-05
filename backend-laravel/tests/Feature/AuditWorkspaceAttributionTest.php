<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Workspace;
use App\Support\Audit;
use App\Support\Ids;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

/** Prepared only: full PostgreSQL *_test schema including 000033 is required. */
final class AuditWorkspaceAttributionTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, operational_metrics RESTART IDENTITY CASCADE');
    }

    public function test_explicit_resource_scope_is_not_replaced_by_actor_membership_or_metadata(): void
    {
        $user = User::factory()->create();
        $first = $this->workspace($user);
        $second = $this->workspace($user);
        Audit::write($user->id, 'link.delete', 'link', 99, ['workspaceId' => $second->id], workspaceId: $first->id);
        $event = DB::table('audit_events')->sole();
        $this->assertSame($first->id, (int) $event->workspace_id);
        $this->assertSame('99', $event->resource_id);
    }

    public function test_unscoped_account_and_legacy_events_remain_unattributed(): void
    {
        $user = User::factory()->create();
        $workspace = $this->workspace($user);
        Audit::write($user->id, 'auth.login', 'user', $user->id, ['workspaceId' => $workspace->id]);
        Audit::write($user->id, 'link.update', 'link', 99);
        $this->assertSame(2, DB::table('audit_events')->whereNull('workspace_id')->count());
    }

    public function test_workspace_resource_identity_survives_deletion_without_a_foreign_key(): void
    {
        $user = User::factory()->create();
        $workspace = $this->workspace($user);
        $id = $workspace->id;
        $workspace->delete();
        Audit::write($user->id, 'workspace.delete', 'workspace', (string) $id);
        $this->assertSame($id, (int) DB::table('audit_events')->sole()->workspace_id);
    }

    public function test_deferred_insert_keeps_scope_after_the_resource_and_workspace_disappear(): void
    {
        $user = User::factory()->create();
        $workspace = $this->workspace($user);
        $id = $workspace->id;
        DB::transaction(function () use ($user, $workspace, $id): void {
            Audit::write($user->id, 'domain.delete', 'domain', 99, workspaceId: $id);
            $this->assertSame(0, DB::table('audit_events')->count());
            $workspace->delete();
        });
        $this->assertSame($id, (int) DB::table('audit_events')->sole()->workspace_id);
    }

    public function test_rollback_discards_the_deferred_event(): void
    {
        $user = User::factory()->create();
        $workspace = $this->workspace($user);
        DB::beginTransaction();
        try {
            Audit::write($user->id, 'webhook.update', 'webhook', 99, workspaceId: $workspace->id);
        } finally {
            DB::rollBack();
        }
        // A later unrelated commit must not release the rolled-back callback.
        DB::transaction(fn () => DB::select('SELECT 1'));
        $this->assertSame(0, DB::table('audit_events')->count());
    }

    public function test_inconsistent_or_invalid_scope_is_reported_without_falling_back_to_unscoped_insert(): void
    {
        Log::spy();
        Audit::write(null, 'link.update', 'link', 99, workspaceId: 0);
        Audit::write(null, 'workspace.rename', 'workspace', 1, workspaceId: 2);
        $this->assertSame(0, DB::table('audit_events')->count());
        Log::shouldHaveReceived('critical')->twice();
    }

    private function workspace(User $owner): Workspace
    {
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Audit scope', 'slug' => 'audit-'.Ids::randomToken(8)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        return $workspace;
    }
}
