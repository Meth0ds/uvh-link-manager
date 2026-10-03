<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\IsoDate;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class SecurityIncidentAuditSchemaTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE security_incident_audits RESTART IDENTITY');
    }

    public static function invalidIdentities(): array
    {
        return ['nonpositive resource' => ['resource'], 'foreign actor' => ['actor'], 'invalid trace' => ['trace']];
    }

    #[DataProvider('invalidIdentities')]
    public function test_schema_rejects_inconsistent_or_unbounded_identity(string $invalid): void
    {
        $user = User::factory()->create();
        $foreign = User::factory()->create();
        DB::beginTransaction();
        try {
            DB::table('security_incident_audits')->insert([
                'user_id' => $invalid === 'actor' ? $foreign->id : $user->id,
                'affected_user_id' => $invalid === 'resource' ? 0 : $user->id,
                'administratively_blocked' => false,
                'incident_correlation_id' => $invalid === 'trace' ? str_repeat('A', 32) : null,
                'incident_at' => now(),
            ]);
            $this->fail('The database must reject the inconsistent receipt.');
        } catch (QueryException $error) {
            $this->assertSame('23514', $error->errorInfo[0]);
        } finally {
            DB::rollBack();
        }
        $this->assertDatabaseCount('security_incident_audits', 0);
    }

    public function test_receipt_keeps_only_bounded_evidence_with_millisecond_timezone_precision(): void
    {
        $user = User::factory()->create();
        $this->assertSame([
            'id', 'user_id', 'affected_user_id', 'administratively_blocked', 'incident_correlation_id', 'incident_at',
        ], Schema::getColumnListing('security_incident_audits'));
        DB::table('security_incident_audits')->insert([
            'user_id' => $user->id, 'affected_user_id' => $user->id, 'administratively_blocked' => true,
            'incident_correlation_id' => str_repeat('b', 32), 'incident_at' => '2026-10-03 02:12:34.123+02:00',
        ]);
        $this->assertSame('2026-10-03T00:12:34.123Z', IsoDate::format(DB::table('security_incident_audits')->value('incident_at')));
    }

    public function test_schema_rollback_refuses_to_destroy_pending_evidence(): void
    {
        $user = User::factory()->create();
        DB::table('security_incident_audits')->insert([
            'user_id' => $user->id, 'affected_user_id' => $user->id, 'administratively_blocked' => false, 'incident_at' => now(),
        ]);
        $migration = require database_path('migrations/2026_10_03_000002_preserve_security_incident_audits.php');
        try {
            $migration->down();
            $this->fail('Rollback must not drop pending audit receipts.');
        } catch (\RuntimeException $error) {
            $this->assertStringContainsString('recovery is pending', $error->getMessage());
        }
        $this->assertTrue(Schema::hasTable('security_incident_audits'));
        $this->assertDatabaseCount('security_incident_audits', 1);
    }

    public function test_empty_schema_can_be_rolled_back_and_rebuilt_without_changing_the_ledger(): void
    {
        $before = DB::table('migrations')->orderBy('id')->get()->toJson();
        $migration = require database_path('migrations/2026_10_03_000002_preserve_security_incident_audits.php');
        DB::beginTransaction();
        try {
            $migration->down();
            $this->assertFalse(Schema::hasTable('security_incident_audits'));
            $migration->up();
            $this->assertTrue(Schema::hasColumns('security_incident_audits', ['user_id', 'affected_user_id', 'incident_at']));
            $this->assertSame($before, DB::table('migrations')->orderBy('id')->get()->toJson());
        } finally {
            DB::rollBack();
        }
    }
}
