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
 * Remote member search for the ownership-transfer picker (F6): it must reach
 * every member of the workspace — not just the page the panel has loaded — and
 * treat the term as text, never as an `ILIKE` pattern. Prepared contracts: run
 * only with the isolated *_test DB guard.
 */
final class WorkspaceMemberSearchTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp(); // Refuses non-*_test databases before fixture writes.
        DB::statement('TRUNCATE users, workspaces, memberships, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
    }

    public function test_the_search_reaches_members_beyond_the_first_list_page(): void
    {
        $owner = User::factory()->create(['name' => 'Propietaria']);
        $workspace = $this->workspace($owner);
        foreach (range(1, 12) as $index) {
            $member = User::factory()->create(['name' => 'Miembro '.str_pad((string) $index, 2, '0', STR_PAD_LEFT)]);
            $workspace->memberships()->create(['user_id' => $member->id, 'role' => 'editor']);
        }
        $this->signIn($owner);

        // The panel's first page holds ~10 members; the search must still find
        // the last one by name and by email.
        $found = $this->getJson($this->path($workspace, 'Miembro 12'))->assertOk();
        $this->assertSame('Miembro 12', $found->json('members.0.name'));
        $this->assertSame(1, $found->json('total'));

        $member = User::where('name', 'Miembro 07')->firstOrFail();
        $byEmail = $this->getJson($this->path($workspace, (string) $member->email))->assertOk();
        $this->assertSame([['id' => $member->id]], collect($byEmail->json('members'))->map(fn ($m) => ['id' => $m['id']])->all());
    }

    public function test_the_term_is_text_and_never_an_ilike_pattern(): void
    {
        $owner = User::factory()->create(['name' => 'Propietaria']);
        $workspace = $this->workspace($owner);
        foreach (['a_b literal', 'axb literal', '100% real', '100 real'] as $name) {
            $member = User::factory()->create(['name' => $name]);
            $workspace->memberships()->create(['user_id' => $member->id, 'role' => 'editor']);
        }
        $this->signIn($owner);

        // `_` and `%` are ILIKE wildcards: unescaped, `a_b` would also match
        // `axb` and `100%` would match `100 real`.
        $underscore = $this->getJson($this->path($workspace, 'a_b'))->assertOk();
        $this->assertSame([['name' => 'a_b literal']], collect($underscore->json('members'))->map(fn ($m) => ['name' => $m['name']])->all());
        $percent = $this->getJson($this->path($workspace, '100%'))->assertOk();
        $this->assertSame([['name' => '100% real']], collect($percent->json('members'))->map(fn ($m) => ['name' => $m['name']])->all());
    }

    public function test_results_are_bounded_and_report_the_real_total(): void
    {
        $owner = User::factory()->create(['name' => 'Propietaria']);
        $workspace = $this->workspace($owner);
        foreach (range(1, 30) as $index) {
            $member = User::factory()->create(['name' => 'Candidato '.$index]);
            $workspace->memberships()->create(['user_id' => $member->id, 'role' => 'editor']);
        }
        $this->signIn($owner);

        $found = $this->getJson($this->path($workspace, 'Candidato', 5))->assertOk();
        $this->assertCount(5, $found->json('members'));
        $this->assertSame(30, $found->json('total'));
    }

    public function test_a_foreign_account_cannot_enumerate_this_workspace(): void
    {
        $owner = User::factory()->create();
        $workspace = $this->workspace($owner);
        $outsider = User::factory()->create();
        $this->signIn($outsider);

        $this->getJson($this->path($workspace, 'cualquiera'))->assertForbidden()
            ->assertExactJson(['error' => 'Sin acceso a este workspace']);
    }

    private function workspace(User $owner): Workspace
    {
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Transferencias', 'slug' => 'transfer-'.Ids::randomToken(8)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);

        return $workspace;
    }

    private function signIn(User $user): void
    {
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
    }

    private function path(Workspace $workspace, string $q, int $perPage = 10): string
    {
        return '/api/v1/workspaces/'.$workspace->id.'/members?q='.rawurlencode($q).'&perPage='.$perPage;
    }
}
