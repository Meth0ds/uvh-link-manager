<?php

namespace Tests\Feature;

use App\Models\Link;
use App\Models\User;
use App\Models\Workspace;
use App\Support\AccountExportDocument;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class AdminUserListingContractTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
    }

    public function test_pages_filters_and_author_counts_preserve_the_public_projection(): void
    {
        $users = $this->fixture();
        $this->signIn($users[1], true);
        $cases = [
            [['perPage' => 2], [6, 5], 6],
            [['page' => 2, 'perPage' => 2], [4, 3], 6],
            [['page' => 3, 'perPage' => 2], [2, 1], 6],
            [['page' => 4, 'perPage' => 2], [], 6],
            [['status' => 'active'], [6, 5, 3, 2, 1], 5],
            [['status' => 'blocked'], [4], 1],
            [['status' => 'admin'], [5, 1], 2],
            [['status' => 'mfa'], [5, 2, 1], 3],
            [['q' => 'author'], [4, 2], 2],
            [['q' => 'absent'], [], 0],
        ];
        $counts = [1 => [0, 0], 2 => [2, 2], 3 => [0, 0], 4 => [1, 1], 5 => [0, 0], 6 => [2, 1]];
        foreach ($cases as [$parameters, $ids, $total]) {
            $response = $this->getJson('/api/v1/admin/users?'.http_build_query($parameters))->assertOk();
            $response->assertJsonPath('total', $total)->assertJsonPath('page', $parameters['page'] ?? 1)
                ->assertJsonPath('perPage', $parameters['perPage'] ?? 25);
            $this->assertSame($ids, array_column($response->json('users'), 'id'));
            foreach ($response->json('users') as $row) {
                $this->assertSame(['id', 'email', 'name', 'is_admin', 'email_verified_at', 'mfa_enabled', 'created_at', 'deleted_at', 'workspaces', 'links'], array_keys($row));
                $this->assertSame($counts[$row['id']], [$row['workspaces'], $row['links']]);
            }
        }
    }

    public function test_account_export_keeps_deleted_authored_links_and_excludes_other_authors(): void
    {
        $this->fixture();
        $out = fopen('php://temp', 'w+b');
        $this->assertIsResource($out);
        try {
            AccountExportDocument::render(2, $out, null);
            rewind($out);
            $document = json_decode((string) stream_get_contents($out), true, flags: JSON_THROW_ON_ERROR);
        } finally {
            fclose($out);
        }
        $this->assertSame([1, 2, 3], array_column($document['createdLinks'], 'id'));
        $this->assertNotNull($document['createdLinks'][2]['deleted_at']);
        $this->assertSame('paused', $document['createdLinks'][1]['state']);
    }

    public function test_the_listing_requires_an_admin_and_mfa_on_the_current_session(): void
    {
        $users = $this->fixture();
        $this->getJson('/api/v1/admin/users')->assertUnauthorized();
        $this->signIn($users[6], true);
        $this->getJson('/api/v1/admin/users')->assertForbidden();
        $this->signIn($users[1], false);
        $this->getJson('/api/v1/admin/users')->assertForbidden()->assertJsonPath('details.reason', 'mfa_required');
    }

    /** @return array<int, User> */
    private function fixture(): array
    {
        $users = [];
        foreach (range(1, 6) as $id) {
            $users[$id] = User::factory()->create([
                'name' => match ($id) {
                    2 => 'Author', 4 => 'Blocked author', default => 'Member '.$id
                },
                'is_admin' => in_array($id, [1, 4, 5], true),
                'mfa_enabled' => in_array($id, [1, 2, 4, 5], true),
                'deleted_at' => $id === 4 ? '2026-01-02' : null,
                'created_at' => '2026-01-01',
            ]);
        }
        $workspaces = [];
        foreach ([2, 4, 6] as $owner) {
            $workspace = Workspace::forceCreate(['owner_user_id' => $owner, 'name' => 'Author scope '.$owner, 'slug' => 'author-scope-'.$owner]);
            $workspace->memberships()->create(['user_id' => $owner, 'role' => 'owner']);
            $workspaces[$owner] = $workspace;
        }
        $workspaces[6]->memberships()->create(['user_id' => 2, 'role' => 'editor']);
        $workspaces[2]->memberships()->create(['user_id' => 6, 'role' => 'editor']);
        foreach ([[2, 2, 'active'], [6, 2, 'paused'], [2, 2, 'deleted'], [2, 6, 'active'], [4, 4, 'active'], [2, 6, 'deleted']] as $index => [$owner, $author, $state]) {
            Link::create([
                'workspace_id' => $workspaces[$owner]->id, 'created_by' => $author, 'alias' => 'author-contract-'.$index,
                'destination' => 'https://example.test/author', 'state' => $state,
                'state_before_delete' => $state === 'deleted' ? 'active' : null,
                'deleted_at' => $state === 'deleted' ? '2026-01-02' : null,
            ]);
        }

        return $users;
    }

    private function signIn(User $user, bool $mfa): void
    {
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, $mfa));
    }
}
