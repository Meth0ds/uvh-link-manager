<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Audit;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

final class AuditOutboxRecoveryTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox RESTART IDENTITY CASCADE');
    }

    public function test_committed_event_survives_unavailable_history_and_materializes_once(): void
    {
        $user = User::factory()->create();
        Schema::rename('audit_events', 'audit_events_unavailable');
        try {
            DB::transaction(static fn () => Audit::write($user->id, 'auth.password_change', 'user', $user->id));
            $this->assertSame(1, DB::table('audit_outbox')->count());
        } finally {
            Schema::rename('audit_events_unavailable', 'audit_events');
        }
        $this->assertTrue(Audit::drain());
        $this->assertTrue(Audit::drain());
        $this->assertSame(1, DB::table('audit_events')->count());
        $this->assertSame(0, DB::table('audit_outbox')->count());
    }

    public function test_rollback_discards_the_durable_event_with_the_mutation(): void
    {
        $user = User::factory()->create();
        DB::beginTransaction();
        try {
            Audit::write($user->id, 'auth.password_change', 'user', $user->id);
            $this->assertSame(1, DB::table('audit_outbox')->count());
            $this->assertSame(0, DB::table('audit_events')->count());
        } finally {
            DB::rollBack();
        }
        $this->assertSame(0, DB::table('audit_outbox')->count());
    }
}
