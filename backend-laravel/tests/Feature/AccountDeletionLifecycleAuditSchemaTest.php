<?php

namespace Tests\Feature;

use App\Models\AccountDeletionRequest;
use App\Models\User;
use App\Support\AccountDeletionLifecycleAudit;
use App\Support\IsoDate;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class AccountDeletionLifecycleAuditSchemaTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE account_deletion_lifecycle_audits RESTART IDENTITY');
    }

    private function receipt(): array
    {
        $user = User::factory()->create();
        $request = AccountDeletionRequest::create(['user_id' => $user->id, 'security_version' => 1, 'status' => 'cancelled'])->refresh();

        return ['user_id' => $user->id, 'request_id' => $request->id, 'affected_request_id' => $request->id,
            'action' => 'account.deletion_cancelled_mail_unconfirmed', 'lifecycle_at' => '2026-10-04 02:12:34.123+02:00'];
    }

    public static function invalidIdentities(): array
    {
        return [['zero'], ['negative'], ['foreign_request'], ['reason']];
    }

    #[DataProvider('invalidIdentities')]
    public function test_database_rejects_invalid_identity_and_reason(string $invalid): void
    {
        $receipt = $this->receipt();
        if ($invalid === 'reason') {
            $receipt['action'] = 'account.deletion_cancelled';
        } elseif ($invalid === 'foreign_request') {
            $receipt['affected_request_id']++;
        } else {
            $receipt['affected_request_id'] = $invalid === 'zero' ? 0 : -1;
        }
        DB::beginTransaction();
        try {
            DB::table('account_deletion_lifecycle_audits')->insert($receipt);
            $this->fail('Invalid lifecycle evidence must be rejected.');
        } catch (QueryException $error) {
            $this->assertSame('23514', $error->errorInfo[0]);
        } finally {
            DB::rollBack();
        }
        $this->assertDatabaseCount('account_deletion_lifecycle_audits', 0);
    }

    public function test_receipt_contains_bounded_evidence_with_millisecond_timezone_precision(): void
    {
        $this->assertSame(['id', 'user_id', 'request_id', 'affected_request_id', 'action', 'lifecycle_at'], Schema::getColumnListing('account_deletion_lifecycle_audits'));
        DB::table('account_deletion_lifecycle_audits')->insert($this->receipt());
        $this->assertSame('2026-10-04T00:12:34.123Z', IsoDate::format(DB::table('account_deletion_lifecycle_audits')->value('lifecycle_at')));
    }

    public function test_rollback_refuses_to_destroy_pending_evidence(): void
    {
        DB::table('account_deletion_lifecycle_audits')->insert($this->receipt());
        $migration = require database_path('migrations/2026_10_04_000001_preserve_account_deletion_lifecycle_audits.php');
        try {
            $migration->down();
            $this->fail('Rollback must preserve pending evidence.');
        } catch (\RuntimeException $error) {
            $this->assertStringContainsString('recovery is pending', $error->getMessage());
        }
        $this->assertTrue(Schema::hasTable('account_deletion_lifecycle_audits'));
        $this->assertDatabaseCount('account_deletion_lifecycle_audits', 1);
    }

    public function test_empty_schema_can_be_rebuilt_without_changing_migration_ledger(): void
    {
        $before = DB::table('migrations')->orderBy('id')->get()->toJson();
        $this->assertSame(1, DB::table('migrations')->where('migration', '2026_10_04_000001_preserve_account_deletion_lifecycle_audits')->count());
        $migration = require database_path('migrations/2026_10_04_000001_preserve_account_deletion_lifecycle_audits.php');
        DB::beginTransaction();
        try {
            $migration->down();
            $this->assertFalse(Schema::hasTable('account_deletion_lifecycle_audits'));
            $migration->up();
            $this->assertTrue(Schema::hasColumns('account_deletion_lifecycle_audits', ['request_id', 'affected_request_id', 'lifecycle_at']));
            $this->assertSame($before, DB::table('migrations')->orderBy('id')->get()->toJson());
        } finally {
            DB::rollBack();
        }
    }

    public function test_bounded_recovery_consumes_receipts_and_admits_each_event_once(): void
    {
        $receipt = $this->receipt();
        DB::table('audit_events')->where('action', $receipt['action'])->delete();
        DB::table('account_deletion_lifecycle_audits')->insert(array_fill(0, 101, $receipt));
        try {
            AccountDeletionLifecycleAudit::reconcile();
            $this->fail('An incomplete bounded pass must remain visibly pending.');
        } catch (\RuntimeException $error) {
            $this->assertStringContainsString('pending after bounded pass', $error->getMessage());
        }
        $this->assertDatabaseCount('account_deletion_lifecycle_audits', 1);
        $this->assertSame(100, DB::table('audit_events')->where('action', $receipt['action'])->count());
        AccountDeletionLifecycleAudit::reconcile();
        AccountDeletionLifecycleAudit::reconcile();
        $this->assertDatabaseCount('account_deletion_lifecycle_audits', 0);
        $this->assertSame(101, DB::table('audit_events')->where('action', $receipt['action'])->count());
    }
}
