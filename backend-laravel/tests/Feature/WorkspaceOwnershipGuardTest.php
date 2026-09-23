<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Workspace;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * `owner_user_id` is not mass-assignable on purpose.
 *
 * Moving ownership is a guarded operation — `transferOwnership` demands owner
 * role, step-up MFA and a deterministic set of row locks — and these tests pin
 * the guard that keeps a future `Workspace::update($request->all())` from
 * walking around all of that by accident.
 */
final class WorkspaceOwnershipGuardTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, mail_outbox, audit_events, operational_metrics RESTART IDENTITY CASCADE');
    }

    public function test_ownership_cannot_move_through_mass_assignment(): void
    {
        $owner = User::factory()->create();
        $intruder = User::factory()->create();
        $workspace = Workspace::forceCreate([
            'name' => 'Guarded', 'slug' => 'guarded-workspace', 'owner_user_id' => $owner->id,
        ]);

        // Legitimate fields still update; the owner column simply is not part
        // of the mass-assignment surface, so it stays where it was.
        $workspace->update(['name' => 'Renamed', 'owner_user_id' => $intruder->id]);

        $workspace->refresh();
        $this->assertSame('Renamed', $workspace->name);
        $this->assertSame((int) $owner->id, (int) $workspace->owner_user_id);
    }

    public function test_the_owner_column_stays_out_of_the_mass_assignment_surface(): void
    {
        // The behavioural guard above is the consequence; this is the contract
        // itself, so the next `fill()` cannot turn into a silent transfer.
        $this->assertNotContains('owner_user_id', (new Workspace)->getFillable());
    }
}
