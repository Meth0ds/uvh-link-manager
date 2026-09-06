<?php

namespace Tests\Feature;

use App\Jobs\DeliverMailOutboxJob;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Prepared, not executed: parent checks the *_test database before TRUNCATE. */
final class WorkspaceOwnershipLimitTest extends TestCase
{
    private const PASSWORD = 'tiovivo-cobrizo-astilla-42';

    private const RECOVERY = 'ABCD2345EFGH6789';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, mail_outbox, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        config(['cache.default' => 'array']);
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'ownership-limit-csrf')->withHeaders(['X-CSRF-Token' => 'ownership-limit-csrf']);
        Queue::fake();
    }

    public static function boundaryCounts(): array
    {
        return ['last free slot' => [19], 'at limit' => [20], 'legacy excess' => [21]];
    }

    #[DataProvider('boundaryCounts')]
    public function test_creation_counts_owned_workspaces_not_memberships(int $ownedCount): void
    {
        $owner = User::factory()->create();
        $this->ownedWorkspaces($owner, $ownedCount);
        $other = User::factory()->create();
        // Memberships in someone else's workspaces do not spend ownership quota.
        foreach ($this->ownedWorkspaces($other, 2) as $workspace) {
            $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'viewer']);
        }
        $this->signIn($owner);
        $allowed = $ownedCount < 20;
        $response = $this->postJson('/api/v1/workspaces', ['name' => 'Boundary workspace'])
            ->assertStatus($allowed ? 201 : 429);
        $this->assertSame($ownedCount + (int) $allowed, $owner->ownedWorkspaces()->count());
        $this->assertSame($ownedCount + 2 + (int) $allowed, DB::table('memberships')->where('user_id', $owner->id)->count());
        if ($allowed) {
            $this->assertDatabaseHas('memberships', ['workspace_id' => $response->json('workspace.id'), 'user_id' => $owner->id, 'role' => 'owner']);
        }
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();
    }

    #[DataProvider('boundaryCounts')]
    public function test_transfer_checks_recipient_quota_without_spending_rejected_recovery_code(int $ownedCount): void
    {
        $actor = User::factory()->create([
            'password_hash' => Hash::make(self::PASSWORD), 'mfa_enabled' => true,
            'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP'),
            'recovery_codes' => [Ids::sha256Hex(self::RECOVERY)],
        ]);
        $target = User::factory()->create(['password_hash' => Hash::make(self::PASSWORD)]);
        $received = $this->ownedWorkspaces($target, $ownedCount);
        // A legacy owner above the cap must still be able to transfer OUT.
        // Only the recipient gains ownership; extra viewer memberships do not count.
        $donated = $this->ownedWorkspaces($actor, 21);
        foreach ($donated as $workspace) {
            $workspace->memberships()->create(['user_id' => $target->id, 'role' => 'viewer']);
        }
        $workspace = $donated[0];
        $this->signIn($actor);
        $allowed = $ownedCount < 20;
        $payload = [
            'targetUserId' => (int) $target->id, 'password' => self::PASSWORD, 'factorCode' => self::RECOVERY,
        ];
        $this->postJson('/api/v1/workspaces/'.$workspace->id.'/transfer-ownership', $payload)
            ->assertStatus($allowed ? 200 : 429);

        $this->assertSame($ownedCount + (int) $allowed, $target->ownedWorkspaces()->count());
        $this->assertSame(21 - (int) $allowed, $actor->ownedWorkspaces()->count());
        $this->assertSame($allowed ? [] : [Ids::sha256Hex(self::RECOVERY)], $actor->refresh()->recovery_codes);
        $this->assertDatabaseHas('workspaces', ['id' => $workspace->id, 'owner_user_id' => $allowed ? $target->id : $actor->id]);
        $this->assertDatabaseHas('memberships', ['workspace_id' => $workspace->id, 'user_id' => $actor->id, 'role' => $allowed ? 'admin' : 'owner']);
        $this->assertDatabaseHas('memberships', ['workspace_id' => $workspace->id, 'user_id' => $target->id, 'role' => $allowed ? 'owner' : 'viewer']);
        $this->assertSame(1, $workspace->memberships()->where('role', 'owner')->count());
        $this->assertDatabaseCount('mail_outbox', $allowed ? 2 : 0);
        $this->assertSame((int) $allowed, DB::table('audit_events')->where('action', 'workspace.ownership_transfer')->count());
        if ($allowed) {
            Queue::assertPushed(DeliverMailOutboxJob::class, 2);
        } else {
            Queue::assertNothingPushed();
        }

        if ($ownedCount === 20) {
            // Free a slot through the real deletion endpoint, then retry the
            // rejected transfer with the SAME one-use recovery code.
            $this->signIn($target);
            $this->deleteJson('/api/v1/workspaces/'.$received[0]->id, [
                'confirmation' => $received[0]->name, 'password' => self::PASSWORD,
            ])->assertOk();
            $this->assertSame(19, $target->ownedWorkspaces()->count());
            $this->signIn($actor);
            $this->postJson('/api/v1/workspaces/'.$workspace->id.'/transfer-ownership', $payload)->assertOk();
            $this->assertSame(20, $target->ownedWorkspaces()->count());
            $this->assertSame(20, $actor->ownedWorkspaces()->count());
            $this->assertSame([], $actor->refresh()->recovery_codes);
            $this->assertDatabaseHas('workspaces', ['id' => $workspace->id, 'owner_user_id' => $target->id]);
            $this->assertDatabaseCount('mail_outbox', 3);
            Queue::assertPushed(DeliverMailOutboxJob::class, 3);
        }
    }

    /** @return list<Workspace> */
    private function ownedWorkspaces(User $owner, int $count): array
    {
        $workspaces = [];
        for ($index = 0; $index < $count; $index++) {
            $workspace = $owner->ownedWorkspaces()->create([
                'name' => 'Owned '.$index, 'slug' => 'owner-'.$owner->id.'-'.$index,
            ]);
            $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
            $workspaces[] = $workspace;
        }

        return $workspaces;
    }

    private function signIn(User $user): void
    {
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), 1, true));
    }
}
