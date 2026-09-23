<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Ids;
use App\Support\LinkService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * Lifecycle state derivation.
 *
 * `LinkService::validate()` refuses `scheduled_at >= expires_at`, so an
 * admitted write can never produce a link that is scheduled and expired at
 * once. Derivation is still held to the honest order — expiry before
 * scheduling — so a writer that ever skips validation derives `expired` rather
 * than a live-looking `scheduled` state from a link that may not be served.
 */
final class LinkStateDerivationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, quotas, links, redirect_rules, audit_events, operational_metrics, jobs RESTART IDENTITY CASCADE');
        Queue::fake();
    }

    public function test_a_crossed_pair_is_refused_by_validation_and_derives_expired_when_forced(): void
    {
        [$workspaceId, $user] = $this->workspaceWithOwner();

        $crossed = [
            'destination' => 'https://example.com/crossed',
            'scheduled_at' => now()->addDay()->toIso8601String(),
            'expires_at' => now()->subDay()->toIso8601String(),
        ];
        $this->assertFalse(LinkService::validate($crossed)['ok']);

        // This write is exactly what a future caller that skips `validate()`
        // would perform; the derived state must not look alive.
        $created = LinkService::create($workspaceId, $user->id, $crossed);
        $this->assertSame('expired', $created['state']);
    }

    public function test_admitted_pairs_derive_their_expected_states(): void
    {
        [$workspaceId, $user] = $this->workspaceWithOwner();

        $scheduled = LinkService::create($workspaceId, $user->id, [
            'destination' => 'https://example.com/scheduled',
            'scheduled_at' => now()->addDay()->toIso8601String(),
            'expires_at' => now()->addDays(2)->toIso8601String(),
        ]);
        $this->assertSame('scheduled', $scheduled['state']);

        $expired = LinkService::create($workspaceId, $user->id, [
            'destination' => 'https://example.com/expired',
            'expires_at' => now()->subDay()->toIso8601String(),
        ]);
        $this->assertSame('expired', $expired['state']);

        $active = LinkService::create($workspaceId, $user->id, [
            'destination' => 'https://example.com/active',
            'scheduled_at' => now()->subDay()->toIso8601String(),
            'expires_at' => now()->addDay()->toIso8601String(),
        ]);
        $this->assertSame('active', $active['state']);
    }

    /** @return array{int, User} */
    private function workspaceWithOwner(): array
    {
        $user = User::factory()->create(['email_verified_at' => now()]);
        $workspaceId = DB::table('workspaces')->insertGetId([
            'name' => 'Derivation', 'slug' => 'derivation-'.Ids::randomToken(6),
            'owner_user_id' => $user->id, 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('memberships')->insert([
            'workspace_id' => $workspaceId, 'user_id' => $user->id, 'role' => 'owner', 'created_at' => now(),
        ]);

        return [$workspaceId, $user];
    }
}
