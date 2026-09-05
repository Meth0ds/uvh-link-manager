<?php

namespace Tests\Feature;

use App\Models\CustomDomain;
use App\Models\Invitation;
use App\Models\Link;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Prepared only: existing full schema in isolated *_test; no mail or probes. */
final class WorkspaceOnboardingTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
    }

    public function test_empty_workspace_returns_only_derived_facts_and_capabilities(): void
    {
        $owner = User::factory()->create();
        $workspace = $this->workspace($owner);
        $this->signIn($owner);
        $this->getJson($this->path($workspace))->assertOk()->assertExactJson([
            'workspaceId' => $workspace->id, 'role' => 'owner',
            'facts' => [
                'linkPresent' => false, 'redirectObserved' => false, 'domainPresent' => false,
                'teammatePresent' => false, 'invitationPending' => false, 'mfaEnabled' => false,
            ],
            'capabilities' => ['createLink' => true, 'addDomain' => true, 'inviteTeam' => true],
        ])->assertHeader('Cache-Control', 'max-age=0, no-store, private');
        $this->assertSame(0, DB::table('links')->count());
        $this->assertSame(0, DB::table('mail_outbox')->count());
    }

    public function test_header_and_foreign_resources_cannot_change_the_authorized_workspace(): void
    {
        $owner = User::factory()->create();
        $workspace = $this->workspace($owner);
        $otherOwner = User::factory()->create();
        $other = $this->workspace($otherOwner);
        $this->link($other, $otherOwner);
        $this->signIn($owner);
        $this->withHeader('X-Workspace-Id', (string) $other->id)->getJson($this->path($workspace))
            ->assertOk()->assertJsonPath('facts.linkPresent', false)->assertJsonPath('facts.redirectObserved', false);
        $this->getJson($this->path($other))->assertForbidden()->assertExactJson(['error' => 'Sin acceso a este workspace']);
        $this->getJson('/api/v1/workspaces/999999/getting-started')->assertForbidden()
            ->assertExactJson(['error' => 'Sin acceso a este workspace']);
    }

    public function test_facts_follow_resources_and_current_user_mfa_instead_of_a_progress_copy(): void
    {
        $owner = User::factory()->create();
        $workspace = $this->workspace($owner);
        $link = $this->link($workspace, $owner);
        CustomDomain::create([
            'workspace_id' => $workspace->id, 'domain' => 'onboarding.example.test',
            'verification_token' => 'fixture-private-challenge', 'state' => 'pending',
        ]);
        $this->signIn($owner);
        $this->getJson($this->path($workspace))->assertOk()->assertJsonPath('facts.linkPresent', true)
            ->assertJsonPath('facts.redirectObserved', true)->assertJsonPath('facts.domainPresent', true)
            ->assertJsonMissing(['verification_token' => 'fixture-private-challenge']);
        // A domain record is not a TLS certificate, and a click counter is not
        // proof of browser arrival. These fields deliberately promise neither.
        $link->delete();
        $owner->update(['mfa_enabled' => true]);
        $this->getJson($this->path($workspace))->assertOk()->assertJsonPath('facts.linkPresent', false)
            ->assertJsonPath('facts.redirectObserved', false)->assertJsonPath('facts.mfaEnabled', true);
    }

    public function test_invitation_facts_require_live_authority_and_are_hidden_from_viewers(): void
    {
        $owner = User::factory()->create();
        $workspace = $this->workspace($owner);
        $invitation = Invitation::create([
            'workspace_id' => $workspace->id, 'invited_by' => $owner->id,
            'email' => 'private-recipient@example.test', 'role' => 'admin', 'status' => 'pending',
            'token' => Ids::sha256Hex('fixture'), 'expires_at' => now()->addDay(),
        ]);
        $this->signIn($owner);
        $this->getJson($this->path($workspace))->assertOk()->assertJsonPath('facts.invitationPending', true);
        $invitation->update(['expires_at' => now()->subMinute()]);
        $this->getJson($this->path($workspace))->assertOk()->assertJsonPath('facts.invitationPending', false);
        $invitation->update(['expires_at' => now()->addDay()]);
        $workspace->memberships()->where('user_id', $owner->id)->update(['role' => 'admin']);
        $this->getJson($this->path($workspace))->assertOk()->assertJsonPath('facts.invitationPending', false);
        $viewer = User::factory()->create();
        $workspace->memberships()->create(['user_id' => $viewer->id, 'role' => 'viewer']);
        $this->signIn($viewer);
        $this->getJson($this->path($workspace))->assertOk()->assertJsonPath('facts.invitationPending', null)
            ->assertJsonPath('facts.teammatePresent', true)
            ->assertJsonPath('capabilities', ['createLink' => false, 'addDomain' => false, 'inviteTeam' => false]);
        $owner->update(['deleted_at' => now()]);
        $this->getJson($this->path($workspace))->assertOk()->assertJsonPath('facts.teammatePresent', false);
    }

    public function test_missing_session_and_revoked_membership_cannot_read_onboarding(): void
    {
        $owner = User::factory()->create();
        $workspace = $this->workspace($owner);
        $this->getJson($this->path($workspace))->assertUnauthorized();
        $this->signIn($owner);
        $workspace->memberships()->delete();
        $this->getJson($this->path($workspace))->assertForbidden();
    }

    private function workspace(User $owner): Workspace
    {
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Onboarding', 'slug' => 'onboarding-'.Ids::randomToken(8)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        return $workspace;
    }

    private function link(Workspace $workspace, User $owner): Link
    {
        return Link::create([
            'workspace_id' => $workspace->id, 'created_by' => $owner->id, 'alias' => 'onboarding-'.Ids::randomToken(8),
            'destination' => 'https://example.test/private-target', 'state' => 'active', 'click_count' => 1,
        ]);
    }

    private function signIn(User $user): void
    {
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
    }

    private function path(Workspace $workspace): string
    {
        return '/api/v1/workspaces/'.$workspace->id.'/getting-started';
    }
}
