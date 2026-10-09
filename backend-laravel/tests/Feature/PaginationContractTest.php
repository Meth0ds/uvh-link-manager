<?php

namespace Tests\Feature;

use App\Models\Invitation;
use App\Models\User;
use App\Models\Workspace;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class PaginationContractTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
    }

    /** @return list<array{array<string, mixed>, int, ?int}> */
    public static function parameters(): array
    {
        return [
            [[], 1, null],
            [['page' => '2', 'perPage' => '1'], 2, 1],
            [['page' => '0002', 'perPage' => '0001'], 2, 1],
            [['page' => '1e2', 'perPage' => '1.5'], 1, null],
            [['page' => ['9'], 'perPage' => ['3']], 1, null],
            [['page' => str_repeat('9', 80), 'perPage' => str_repeat('9', 80)], 10_000, 100],
            // Laravel trims surrounding whitespace before controllers read it.
            [['page' => "2\n", 'perPage' => "3\n"], 2, 3],
            [['page' => '0', 'perPage' => '-1'], 1, null],
        ];
    }

    #[DataProvider('parameters')]
    public function test_admin_lists_keep_their_defaults_and_bounds(array $query, int $page, ?int $perPage): void
    {
        $admin = User::factory()->create(['is_admin' => true, 'mfa_enabled' => true]);
        $this->signIn($admin, true);
        foreach (['users', 'pending-registrations', 'reports', 'account-recoveries', 'destinations', 'appeals', 'domains', 'audit', 'mail-outbox'] as $path) {
            $response = $this->getJson('/api/v1/admin/'.$path.'?'.http_build_query($query))->assertOk();
            $response->assertJsonPath('page', $page)->assertJsonPath('perPage', $perPage ?? ($path === 'audit' ? 50 : 25));
        }
    }

    #[DataProvider('parameters')]
    public function test_workspace_member_and_invitation_pages_keep_their_independent_keys(array $query, int $page, ?int $perPage): void
    {
        $owner = User::factory()->create();
        $workspace = $this->workspace($owner);
        $this->signIn($owner);
        $keys = [];
        foreach ($query as $key => $value) {
            $keys[$key === 'page' ? 'memberPage' : 'memberPerPage'] = $value;
            $keys[$key === 'page' ? 'invitationPage' : 'invitationPerPage'] = $value;
        }
        $this->getJson('/api/v1/workspaces/'.$workspace->id.'?'.http_build_query($keys))->assertOk()
            ->assertJsonPath('membersPage.page', $page)->assertJsonPath('membersPage.perPage', $perPage ?? 25)
            ->assertJsonPath('invitationsPage.page', $page)->assertJsonPath('invitationsPage.perPage', $perPage ?? 25);
    }

    public function test_workspace_pagination_preserves_ties_roles_totals_and_tenant_isolation(): void
    {
        $owner = User::factory()->create(['name' => 'Same name']);
        $workspace = $this->workspace($owner);
        $first = User::factory()->create(['name' => 'Same name']);
        $second = User::factory()->create(['name' => 'Same name']);
        foreach ([$first, $second] as $user) {
            $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'viewer']);
        }
        $foreignOwner = User::factory()->create();
        $foreign = $this->workspace($foreignOwner);
        foreach ([$workspace, $foreign] as $scope) {
            foreach (range(1, 3) as $index) {
                Invitation::create([
                    'workspace_id' => $scope->id,
                    'email' => "invitation{$scope->id}-{$index}@example.test", 'role' => 'viewer',
                    'token' => hash('sha256', "fixture-{$scope->id}-{$index}"), 'invited_by' => $scope->owner_user_id,
                    'status' => 'pending', 'expires_at' => now()->addDay(), 'created_at' => now(),
                ]);
            }
        }
        $this->signIn($owner);
        $response = $this->getJson('/api/v1/workspaces/'.$workspace->id.'?memberPage=2&memberPerPage=1&invitationPage=2&invitationPerPage=2')->assertOk();
        $response->assertJsonPath('membersPage.total', 3)->assertJsonPath('invitationsPage.total', 3);
        $this->assertSame([$first->id], array_column($response->json('members'), 'id'));
        $this->assertSame(["invitation{$workspace->id}-1@example.test"], array_column($response->json('invitations'), 'email'));
        $this->assertStringNotContainsString("invitation{$foreign->id}", $response->getContent());
        $this->signIn($second);
        $this->getJson('/api/v1/workspaces/'.$workspace->id.'?invitationPage=2&invitationPerPage=1')->assertOk()
            ->assertJsonPath('invitations', [])->assertJsonPath('invitationsPage.total', 0);
        $this->getJson('/api/v1/workspaces/'.$foreign->id)->assertForbidden();
    }

    public function test_pagination_does_not_bypass_admin_session_mfa(): void
    {
        $admin = User::factory()->create(['is_admin' => true, 'mfa_enabled' => true]);
        $this->signIn($admin);
        $this->getJson('/api/v1/admin/users?page=0002&perPage=1')->assertForbidden()
            ->assertJsonPath('details.reason', 'mfa_required');
    }

    private function workspace(User $owner): Workspace
    {
        $workspace = Workspace::forceCreate(['owner_user_id' => $owner->id, 'name' => 'Pagination', 'slug' => 'pagination-'.$owner->id]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);

        return $workspace;
    }

    private function signIn(User $user, bool $mfa = false): void
    {
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, $mfa));
    }
}
