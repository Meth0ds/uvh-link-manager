<?php

namespace Tests\Feature;

use App\Models\Invitation;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Prepared only; *_test guard precedes TRUNCATE, PHPUnit uses an array cache. */
final class InvitationBudgetTest extends TestCase
{
    private bool $failAdmission = false;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, mail_outbox, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'invitation-budget-csrf')->withHeader('X-CSRF-Token', 'invitation-budget-csrf');
        Queue::fake();
        DB::listen(function (QueryExecuted $event): void {
            if ($this->failAdmission && str_starts_with(strtolower($event->sql), 'insert')
                && str_contains($event->sql, '"mail_outbox"')) {
                throw new \RuntimeException('Fixture: invitation admission failed after INSERT');
            }
        });
    }

    public function test_attempt_budget_survives_session_and_route_spelling_changes(): void
    {
        [$owner, $workspace] = $this->fixture();
        for ($attempt = 0; $attempt < 20; $attempt++) {
            if ($attempt === 10) {
                $this->signIn($owner); // A distinct real session, not a forged attribute.
            }
            $id = ($attempt % 2 ? '00' : '').$workspace->id;
            // Invalid bodies spend attempts but do not admit mail or consume
            // active capacity: this isolates the middleware from the hard quota.
            $this->postJson('/api/v1/workspaces/'.$id.'/invitations', [])->assertStatus(422);
        }
        $this->postJson('/api/v1/workspaces/'.$workspace->id.'/invitations', [])
            ->assertStatus(429)->assertHeader('Retry-After');
        $this->postJson('/api/v1/workspaces/000'.$workspace->id.'/invitations/999/resend', [])
            ->assertStatus(429)->assertHeader('Retry-After');
        $other = User::factory()->create();
        $workspace->memberships()->create(['user_id' => $other->id, 'role' => 'admin']);
        $this->signIn($other);
        $this->postJson('/api/v1/workspaces/'.$workspace->id.'/invitations', [])->assertStatus(422);
        $this->signIn($owner);
        $otherWorkspace = $this->workspace($owner);
        $this->postJson('/api/v1/workspaces/'.$otherWorkspace->id.'/invitations', [])->assertStatus(422);
        $this->travel(16)->minutes();
        $this->postJson('/api/v1/workspaces/'.$workspace->id.'/invitations', [])->assertStatus(422);
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();
    }

    public static function creationCounts(): array
    {
        return ['last slot' => [99], 'full workspace' => [100]];
    }

    #[DataProvider('creationCounts')]
    public function test_creation_capacity_and_release_by_cancellation(int $count): void
    {
        [$owner, $workspace] = $this->fixture();
        $this->seedInvitations($workspace, $owner, $count);
        $this->seedInvitations($workspace, $owner, 20, true);
        $url = '/api/v1/workspaces/'.$workspace->id.'/invitations';
        $payload = ['email' => 'new-recipient@example.test', 'role' => 'viewer'];
        $this->postJson($url, $payload)->assertStatus($count === 99 ? 201 : 429);
        if ($count === 100) {
            $this->assertDatabaseCount('mail_outbox', 0);
            $this->assertSame(100, $this->activeCount($workspace));
            $firstId = Invitation::where('workspace_id', $workspace->id)->where('expires_at', '>', now())->min('id');
            $this->deleteJson($url.'/'.$firstId)->assertOk();
            $this->postJson($url, $payload)->assertStatus(201);
        }
        $this->assertSame(100, $this->activeCount($workspace));
        $this->assertDatabaseCount('mail_outbox', 1);
    }

    public static function resends(): array
    {
        // Count is the OTHER active invitations, excluding the fixture target.
        return [
            'live at capacity' => [99, 'pending', true, 200],
            'live with legacy excess' => [100, 'pending', true, 200],
            'expired last slot' => [99, 'pending', false, 200],
            'expired without room' => [100, 'pending', false, 429],
            'stored expiry without room' => [100, 'expired', false, 429],
        ];
    }

    #[DataProvider('resends')]
    public function test_resend_only_needs_capacity_when_reviving_an_expired_row(int $count, string $status, bool $live, int $expected): void
    {
        [$owner, $workspace] = $this->fixture();
        $this->seedInvitations($workspace, $owner, $count);
        $invitation = Invitation::create([
            'workspace_id' => $workspace->id, 'invited_by' => $owner->id, 'email' => 'renew@example.test',
            'role' => 'viewer', 'status' => $status, 'token' => Ids::sha256Hex('original-fixture'),
            'expires_at' => $live ? now()->addDay() : now()->subDay(),
        ]);
        $oldExpiry = $invitation->expires_at->toIso8601String();
        $this->postJson('/api/v1/workspaces/'.$workspace->id.'/invitations/'.$invitation->id.'/resend')->assertStatus($expected);
        $this->assertSame($count + (int) ($live || $expected === 200), $this->activeCount($workspace));
        $this->assertDatabaseCount('mail_outbox', $expected === 200 ? 1 : 0);
        if ($expected === 429) {
            $this->assertSame($status, $invitation->refresh()->status);
            $this->assertSame(Ids::sha256Hex('original-fixture'), $invitation->token);
            $this->assertSame($oldExpiry, $invitation->expires_at->toIso8601String());
            Queue::assertNothingPushed();
        }
    }

    public function test_failed_admission_does_not_occupy_the_last_slot(): void
    {
        [$owner, $workspace] = $this->fixture();
        $this->seedInvitations($workspace, $owner, 99);
        $this->failAdmission = true;
        $url = '/api/v1/workspaces/'.$workspace->id.'/invitations';
        $payload = ['email' => 'last-slot@example.test', 'role' => 'viewer'];
        $this->postJson($url, $payload)->assertStatus(503);
        $this->assertSame(99, $this->activeCount($workspace));
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();
        $this->failAdmission = false;
        $this->postJson($url, $payload)->assertStatus(201);
        $this->assertSame(100, $this->activeCount($workspace));
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
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Budget fixture', 'slug' => 'budget-'.strtolower(Ids::randomToken(8))]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);

        return $workspace;
    }

    private function seedInvitations(Workspace $workspace, User $owner, int $count, bool $expired = false): void
    {
        $rows = [];
        for ($index = 0; $index < $count; $index++) {
            $email = ($expired ? 'expired' : 'active').$index.'@example.test';
            $rows[] = [
                'workspace_id' => $workspace->id, 'invited_by' => $owner->id, 'email' => $email,
                'role' => 'viewer', 'status' => 'pending', 'token' => Ids::sha256Hex($workspace->id.'|'.$email),
                'expires_at' => $expired ? now()->subDay() : now()->addDay(), 'created_at' => now(),
            ];
        }
        if ($rows !== []) {
            DB::table('invitations')->insert($rows);
        }
    }

    private function activeCount(Workspace $workspace): int
    {
        return Invitation::where('workspace_id', $workspace->id)->where('status', 'pending')->where('expires_at', '>', now())->count();
    }

    private function signIn(User $user): void
    {
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), 1));
    }
}
