<?php

namespace Tests\Feature;

use App\Models\Link;
use App\Models\User;
use App\Support\DestinationDenylist;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Contesting a block.
 *
 * The documentation claimed an appeal path existed and none did, so a
 * false-positive moderation action — including an automatic one — was final.
 * These tests pin the lifecycle: exactly one open appeal per link, an
 * administrative decision that either restores the link (and withdraws the
 * destination entries that caused it) or upholds the block.
 */
final class LinkAppealTest extends TestCase
{
    private const PASSWORD = 'Correct horse battery staple 42!';

    private const CSRF = 'appeal-csrf';

    private User $owner;

    private int $workspaceId;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, quotas, links, redirect_rules, abuse_reports, audit_events, destination_denylist, destination_reputation_checks, operational_metrics, jobs RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', self::CSRF)->withHeaders(['X-CSRF-Token' => self::CSRF]);

        $this->owner = User::factory()->create(['email_verified_at' => now(), 'password_hash' => Hash::make(self::PASSWORD)]);
        $this->workspaceId = DB::table('workspaces')->insertGetId([
            'name' => 'Appeals',
            'slug' => 'appeals-'.Ids::randomToken(6),
            'owner_user_id' => $this->owner->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('memberships')->insert([
            'workspace_id' => $this->workspaceId,
            'user_id' => $this->owner->id,
            'role' => 'owner',
            'created_at' => now(),
        ]);
    }

    public function test_only_a_blocked_link_can_be_contested_and_only_once(): void
    {
        $link = $this->link('blocked-appeal', 'blocked');
        $this->signInWorkspace();

        $this->postJson("/api/v1/links/{$link->id}/appeal", ['message' => 'Es mi propio dominio.'])
            ->assertCreated()
            ->assertJsonPath('ok', true);

        // One open appeal per link: the queue is a queue, not a mailbox.
        $this->postJson("/api/v1/links/{$link->id}/appeal", ['message' => 'Otra vez.'])->assertStatus(409);
        $this->assertSame(1, DB::table('link_appeals')->where('link_id', $link->id)->where('status', 'open')->count());

        // A link that is not blocked has nothing to contest.
        $active = $this->link('active-appeal', 'active');
        $this->postJson("/api/v1/links/{$active->id}/appeal")->assertStatus(409);
    }

    public function test_the_link_owner_sees_the_open_appeal_in_the_link_state(): void
    {
        $link = $this->link('visible-appeal', 'blocked');
        $this->signInWorkspace();
        $this->postJson("/api/v1/links/{$link->id}/appeal")->assertCreated();

        // Without this the panel could only offer an action that would be refused.
        $this->getJson("/api/v1/links/{$link->id}")->assertOk()->assertJsonPath('appeal.status', 'open');
    }

    public function test_restoring_from_an_appeal_withdraws_the_entries_that_caused_the_block(): void
    {
        DestinationDenylist::blockHost('evil.example', 'Phishing confirmado');
        $link = $this->link('restore-appeal', 'blocked', 'https://evil.example/login');
        $this->signInWorkspace();
        $appealId = (int) $this->postJson("/api/v1/links/{$link->id}/appeal")->assertCreated()->json('appealId');

        // A provider-sourced entry can be overridden by a human, and doing so
        // must remove it: otherwise the next re-analysis blocks the link again
        // and the appeal is theatre.
        $this->signInAdmin();
        $this->postJson("/api/v1/admin/appeals/{$appealId}/decision", ['decision' => 'restore', 'note' => 'Falso positivo'])
            ->assertOk()
            ->assertJsonPath('state', 'active');

        $this->assertSame('active', (string) DB::table('links')->where('id', $link->id)->value('state'));
        $this->assertSame(0, DB::table('destination_denylist')->count());
        $this->assertDatabaseHas('link_appeals', ['id' => $appealId, 'status' => 'restored']);
        $this->assertDatabaseHas('audit_events', ['action' => 'admin.link_appeal_resolved', 'resource_id' => (string) $link->id]);
    }

    public function test_upholding_the_block_leaves_the_link_and_the_denylist_untouched(): void
    {
        DestinationDenylist::blockHost('evil.example', 'Phishing confirmado');
        $link = $this->link('uphold-appeal', 'blocked', 'https://evil.example/login');
        $this->signInWorkspace();
        $appealId = (int) $this->postJson("/api/v1/links/{$link->id}/appeal")->assertCreated()->json('appealId');

        $this->signInAdmin();
        $this->postJson("/api/v1/admin/appeals/{$appealId}/decision", ['decision' => 'uphold'])
            ->assertOk()
            ->assertJsonPath('state', 'blocked');

        $this->assertSame('blocked', (string) DB::table('links')->where('id', $link->id)->value('state'));
        $this->assertSame(1, DB::table('destination_denylist')->count());
        $this->assertDatabaseHas('link_appeals', ['id' => $appealId, 'status' => 'upheld']);
    }

    public function test_an_appeal_cannot_be_decided_twice(): void
    {
        $link = $this->link('twice-appeal', 'blocked');
        $this->signInWorkspace();
        $appealId = (int) $this->postJson("/api/v1/links/{$link->id}/appeal")->assertCreated()->json('appealId');

        $this->signInAdmin();
        $this->postJson("/api/v1/admin/appeals/{$appealId}/decision", ['decision' => 'uphold'])->assertOk();
        $this->postJson("/api/v1/admin/appeals/{$appealId}/decision", ['decision' => 'restore'])->assertStatus(409);
    }

    private function link(string $alias, string $state, string $destination = 'https://destination.example.test/a'): Link
    {
        return Link::create([
            'workspace_id' => $this->workspaceId,
            'created_by' => $this->owner->id,
            'alias' => $alias,
            'destination' => $destination,
            'state' => $state,
        ]);
    }

    private function signInWorkspace(): void
    {
        $this->withCookie(
            (string) config('uvh.session_cookie'),
            SessionManager::create($this->owner->id, Request::create('/'), (int) $this->owner->security_version, true),
        );
        $this->withHeader('X-Workspace-Id', (string) $this->workspaceId);
    }

    private function signInAdmin(): void
    {
        $admin = User::create([
            'email' => 'admin-'.Ids::randomToken(4).'@example.test',
            'name' => 'Platform Admin',
            'password_hash' => 'not-used-in-appeal-test',
            'email_verified_at' => now(),
            'is_admin' => true,
            'mfa_enabled' => true,
            'security_version' => 1,
        ]);
        $token = Ids::randomToken(32);
        DB::table('sessions')->insert([
            'id' => Ids::sha256Hex($token),
            'user_id' => $admin->id,
            'security_version' => 1,
            'mfa_verified_at' => now(),
            'created_at' => now(),
            'last_used_at' => now(),
            'expires_at' => now()->addDay(),
        ]);
        $this->withCookie((string) config('uvh.session_cookie'), $token);
    }
}
