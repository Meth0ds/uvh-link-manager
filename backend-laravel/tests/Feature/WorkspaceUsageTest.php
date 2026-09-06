<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\CustomDomain;
use App\Models\Invitation;
use App\Models\Link;
use App\Models\User;
use App\Models\Webhook;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\WorkspaceLimits;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Isolated *_test contract; no production/local migration or external I/O. */
final class WorkspaceUsageTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
    }

    public static function roles(): array
    {
        return [['owner', true, true], ['admin', true, true], ['editor', true, false], ['viewer', false, false]];
    }

    #[DataProvider('roles')]
    public function test_role_projection_exposes_only_manageable_aggregate_categories(string $role, bool $editor, bool $admin): void
    {
        $owner = User::factory()->create();
        $actor = $role === 'owner' ? $owner : User::factory()->create();
        $workspace = $this->workspace($owner, $actor, $role);
        $this->signIn($actor);

        $response = $this->getJson($this->path($workspace))->assertOk()
            ->assertJsonPath('workspaceId', $workspace->id)->assertJsonPath('role', $role)
            ->assertJsonPath('resources.links.canManage', $editor)
            ->assertJsonPath('resources.domains.canManage', $editor)
            ->assertJsonPath('resources.webhooks.canManage', $editor)
            ->assertJsonPath('resources.members.canManage', $admin)
            ->assertJsonPath('resources.members.limit', null)
            ->assertJsonPath('resources.members.policy', 'not_configured')
            ->assertJsonPath('basis', 'snapshot_not_reservation');
        if ($editor) {
            $response->assertJsonPath('resources.tokens.limit', WorkspaceLimits::ACTIVE_TOKENS);
        } else {
            $response->assertJsonPath('resources.tokens', null);
        }
        if ($admin) {
            $response->assertJsonPath('resources.invitations.limit', WorkspaceLimits::ACTIVE_INVITATIONS);
        } else {
            $response->assertJsonPath('resources.invitations', null);
        }
    }

    public function test_counts_match_each_enforced_mutation_policy_without_treating_terminal_rows_as_active(): void
    {
        $owner = User::factory()->create();
        $workspace = $this->workspace($owner);
        $member = User::factory()->create();
        $workspace->memberships()->create(['user_id' => $member->id, 'role' => 'viewer']);
        $this->link($workspace, $owner, 'usage-a');
        $this->link($workspace, $owner, 'usage-b');
        $this->link($workspace, $owner, 'usage-deleted', now());
        foreach (['one', 'two'] as $name) {
            CustomDomain::create(['workspace_id' => $workspace->id,
                'domain' => $name.'.usage.example.test', 'verification_token' => 'uvh-verify='.Ids::randomToken(24), 'state' => 'pending']);
        }
        ApiToken::create(['workspace_id' => $workspace->id, 'name' => 'active', 'token_hash' => hash('sha256', 'active'),
            'scopes' => ['links:read'], 'created_by' => $owner->id]);
        ApiToken::create(['workspace_id' => $workspace->id, 'name' => 'expired', 'token_hash' => hash('sha256', 'expired'),
            'scopes' => ['links:read'], 'expires_at' => now()->subSecond(), 'created_by' => $owner->id]);
        ApiToken::create(['workspace_id' => $workspace->id, 'name' => 'revoked', 'token_hash' => hash('sha256', 'revoked'),
            'scopes' => ['links:read'], 'revoked_at' => now(), 'created_by' => $owner->id]);
        foreach ([true, false] as $active) {
            Webhook::create(['workspace_id' => $workspace->id, 'created_by' => $owner->id,
                'url' => 'https://hooks.example.test/'.($active ? 'active' : 'inactive'), 'secret' => 'fixture-secret-not-returned',
                'events' => ['link.created'], 'active' => $active, 'config_version' => 1]);
        }
        $this->invitation($workspace, $owner, 'pending@example.test', 'pending', now()->addHour());
        $this->invitation($workspace, $owner, 'expired@example.test', 'pending', now()->subSecond());
        $this->invitation($workspace, $owner, 'accepted@example.test', 'accepted', now()->addHour());

        $this->signIn($owner);
        $this->getJson($this->path($workspace))->assertOk()
            ->assertJsonPath('resources.links.used', 2)->assertJsonPath('resources.links.limit', 7)
            ->assertJsonPath('resources.links.remaining', 5)->assertJsonPath('resources.links.reached', false)
            ->assertJsonPath('resources.domains.used', 2)->assertJsonPath('resources.members.used', 2)
            ->assertJsonPath('resources.tokens.used', 1)->assertJsonPath('resources.webhooks.used', 2)
            ->assertJsonPath('resources.invitations.used', 1);
    }

    public function test_reached_capacity_never_reports_negative_remaining(): void
    {
        $owner = User::factory()->create();
        $workspace = $this->workspace($owner);
        DB::table('quotas')->where('workspace_id', $workspace->id)->update(['links_limit' => 0]);
        $this->link($workspace, $owner, 'legacy-overage');
        $this->signIn($owner);
        $this->getJson($this->path($workspace))->assertOk()->assertJsonPath('resources.links.used', 1)
            ->assertJsonPath('resources.links.remaining', 0)->assertJsonPath('resources.links.reached', true);
    }

    public function test_missing_link_quota_is_unavailable_instead_of_fabricating_default_or_unlimited_capacity(): void
    {
        $owner = User::factory()->create();
        $workspace = $this->workspace($owner);
        DB::table('quotas')->where('workspace_id', $workspace->id)->delete();
        $this->signIn($owner);
        $this->getJson($this->path($workspace))->assertOk()
            ->assertJsonPath('resources.links.used', 0)->assertJsonPath('resources.links.limit', null)
            ->assertJsonPath('resources.links.remaining', null)->assertJsonPath('resources.links.reached', null)
            ->assertJsonPath('resources.links.policy', 'unavailable');
    }

    public function test_analytics_values_are_declared_policy_not_proof_of_completed_purge(): void
    {
        config(['uvh.housekeeping.analytics_retention_days' => 37]);
        $owner = User::factory()->create();
        $workspace = $this->workspace($owner);
        $this->signIn($owner);
        $this->getJson($this->path($workspace))->assertOk()
            ->assertJsonPath('analytics.retentionDays', 37)
            ->assertJsonPath('analytics.maximumQueryRangeDays', WorkspaceLimits::ANALYTICS_RANGE_DAYS)
            ->assertJsonPath('analytics.basis', 'configured_policy')->assertJsonPath('analytics.purgeVerified', false);
    }

    public function test_foreign_tenant_and_missing_session_never_return_counts_or_existence_details(): void
    {
        $owner = User::factory()->create();
        $workspace = $this->workspace($owner);
        $this->link($workspace, $owner, 'private-count');
        $this->getJson($this->path($workspace))->assertUnauthorized();
        $this->signIn(User::factory()->create());
        $response = $this->getJson($this->path($workspace))->assertForbidden();
        $response->assertExactJson(['error' => 'Sin acceso a este workspace']);
    }

    public function test_other_workspace_rows_and_sensitive_values_never_cross_the_projection(): void
    {
        $owner = User::factory()->create();
        $workspace = $this->workspace($owner);
        $foreign = $this->workspace(User::factory()->create());
        $this->link($foreign, User::findOrFail($foreign->owner_user_id), 'foreign-secret-alias');
        Webhook::create(['workspace_id' => $foreign->id, 'created_by' => $foreign->owner_user_id,
            'url' => 'https://private.example.test/secret', 'secret' => 'fixture-private-ciphertext',
            'events' => ['link.created'], 'active' => true, 'config_version' => 1]);
        $this->signIn($owner);
        $response = $this->getJson($this->path($workspace))->assertOk()
            ->assertJsonPath('resources.links.used', 0)->assertJsonPath('resources.webhooks.used', 0);
        $body = $response->getContent();
        $this->assertStringNotContainsString('foreign-secret', $body);
        $this->assertStringNotContainsString('private.example', $body);
        $this->assertStringNotContainsString('ciphertext', $body);
    }

    public function test_missing_schema_returns_generic_unavailable_without_zero_fallback(): void
    {
        $owner = User::factory()->create();
        $workspace = $this->workspace($owner);
        $this->signIn($owner);
        DB::beginTransaction();
        try {
            Schema::table('quotas', fn ($table) => $table->renameColumn('links_limit', 'usage_test_hidden_limit'));
            $this->getJson($this->path($workspace))->assertStatus(503)
                ->assertExactJson(['error' => 'No se pudo consultar el uso. Inténtalo más tarde.']);
        } finally {
            DB::rollBack();
        }
    }

    public function test_usage_budget_is_shared_across_workspaces_and_new_sessions(): void
    {
        $owner = User::factory()->create();
        $first = $this->workspace($owner);
        $second = $this->workspace($owner);
        $this->signIn($owner);
        for ($i = 0; $i < 30; $i++) {
            $this->getJson($this->path($i % 2 ? $first : $second))->assertOk();
        }
        $this->signIn($owner);
        $this->getJson($this->path($first))->assertStatus(429)->assertHeader('Retry-After');
    }

    private function workspace(User $owner, ?User $actor = null, string $role = 'owner'): Workspace
    {
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Usage', 'slug' => 'usage-'.Ids::randomToken(8)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 7]);
        if ($actor && $actor->id !== $owner->id) {
            $workspace->memberships()->create(['user_id' => $actor->id, 'role' => $role]);
        }

        return $workspace;
    }

    private function link(Workspace $workspace, User $owner, string $alias, $deletedAt = null): void
    {
        Link::create(['workspace_id' => $workspace->id, 'created_by' => $owner->id, 'alias' => $alias,
            'destination' => 'https://private.example.test/destination', 'state' => $deletedAt ? 'deleted' : 'active',
            'deleted_at' => $deletedAt]);
    }

    private function invitation(Workspace $workspace, User $owner, string $email, string $status, $expiresAt): void
    {
        Invitation::create(['workspace_id' => $workspace->id, 'email' => $email, 'role' => 'viewer',
            'token' => Ids::randomToken(48), 'invited_by' => $owner->id, 'status' => $status, 'expires_at' => $expiresAt]);
    }

    private function signIn(User $user): void
    {
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
    }

    private function path(Workspace $workspace): string
    {
        return '/api/v1/workspaces/'.$workspace->id.'/usage';
    }
}
