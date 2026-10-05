<?php

namespace Tests\Feature;

use App\Jobs\GenerateDataExportJob;
use App\Models\DataExportRequest;
use App\Models\User;
use App\Support\Ids;
use App\Support\OperationalMetrics;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Actual database queue on a separate PDO, exclusively the guarded test DB. */
final class DataExportQueueCommitTest extends TestCase
{
    private const PASSWORD = 'fixture-password-for-export';

    private const CODE = 'ABCD2345EFGH6789';

    private ConnectionInterface $queueDb;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, jobs, audit_events, audit_outbox, mail_outbox, operational_metrics RESTART IDENTITY CASCADE');
        $database = config('database.connections.'.config('database.default'));
        $this->assertIsArray($database);
        config([
            'database.connections.export-publication' => $database,
            'queue.default' => 'database',
            'queue.connections.database.connection' => 'export-publication',
            'queue.connections.database.after_commit' => false,
        ]);
        $this->queueDb = DB::connection('export-publication');
        $this->assertSame(DB::connection()->getDatabaseName(), $this->queueDb->getDatabaseName());
        $this->assertStringEndsWith('_test', $this->queueDb->getDatabaseName());
        $this->assertNotSame(DB::connection()->getPdo(), $this->queueDb->getPdo());
        Storage::fake('local');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'export-commit-csrf')->withHeader('X-CSRF-Token', 'export-commit-csrf');
        $this->freezeSecond();
    }

    protected function tearDown(): void
    {
        while (DB::transactionLevel() > 0) {
            DB::rollBack();
        }
        DB::purge('export-publication');
        parent::tearDown();
    }

    private function actor(): User
    {
        $user = User::factory()->create([
            'password_hash' => Hash::make(self::PASSWORD),
            'mfa_enabled' => true,
            'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP'),
            'recovery_codes' => [Ids::sha256Hex(self::CODE)],
        ]);
        $raw = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true);
        $this->withCookie((string) config('session.cookie'), $raw);

        return $user;
    }

    private function requestExport(): TestResponse
    {
        return $this->postJson('/api/v1/auth/data-export', ['password' => self::PASSWORD, 'factorCode' => self::CODE]);
    }

    private function published(): int
    {
        return $this->queueDb->table('jobs')->where('queue', 'exports')->count();
    }

    private function queuedJob(int $id): GenerateDataExportJob
    {
        $payload = (string) $this->queueDb->table('jobs')->where('queue', 'exports')->value('payload');
        $this->assertStringNotContainsString(self::PASSWORD, $payload);
        $this->assertStringNotContainsString(self::CODE, $payload);
        $decoded = json_decode($payload, true, 512, JSON_THROW_ON_ERROR);
        $job = unserialize($decoded['data']['command'], ['allowed_classes' => [GenerateDataExportJob::class]]);
        $this->assertInstanceOf(GenerateDataExportJob::class, $job);
        $this->assertSame($id, $job->requestId);

        return $job;
    }

    public function test_no_job_is_visible_to_an_independent_connection_before_outer_commit(): void
    {
        $this->actor();
        DB::beginTransaction();
        try {
            $response = $this->requestExport()->assertStatus(202);
            $id = (int) $response->json('export.id');
            $this->assertTrue(DataExportRequest::whereKey($id)->exists());
            $this->assertFalse($this->queueDb->table('data_export_requests')->where('id', $id)->exists());
            $this->assertDatabaseCount('audit_outbox', 1);
            $this->assertDatabaseCount('audit_events', 0);
            $this->assertSame(0, $this->published(), 'The producer must not expose a job for an uncommitted request');
        } finally {
            DB::rollBack();
        }
    }

    public function test_outer_rollback_leaves_no_durable_job_or_business_effect(): void
    {
        $user = $this->actor();
        $codes = $user->recovery_codes;
        DB::beginTransaction();
        $id = (int) $this->requestExport()->assertStatus(202)->json('export.id');
        DB::rollBack();
        $this->assertFalse(DataExportRequest::whereKey($id)->exists());
        $this->assertSame($codes, $user->refresh()->recovery_codes);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('audit_events', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertSame([], Storage::disk('local')->files('account-exports'));
        $this->assertSame(0, $this->published(), 'A queue on another connection cannot undo an early publication');
    }

    public function test_outer_commit_publishes_once_for_a_visible_request_and_preserves_duplicate_refusal(): void
    {
        $user = $this->actor();
        DB::beginTransaction();
        $id = (int) $this->requestExport()->assertStatus(202)->json('export.id');
        DB::commit();
        $this->assertTrue($this->queueDb->table('data_export_requests')->where('id', $id)->exists());
        $this->assertSame(1, $this->published());
        $this->queuedJob($id);
        $this->assertSame([], $user->refresh()->recovery_codes);
        $this->assertDatabaseHas('data_export_requests', ['id' => $id, 'status' => 'processing', 'artifact_path' => null]);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.data_export_requested')->count());
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->requestExport()->assertStatus(409);
        $this->assertSame(1, $this->published());
        $this->assertDatabaseCount('mail_outbox', 0);
    }

    public function test_rollback_to_a_savepoint_does_not_publish_when_the_remaining_outer_transaction_commits(): void
    {
        $user = $this->actor();
        $codes = $user->recovery_codes;
        DB::beginTransaction();
        DB::beginTransaction();
        $this->requestExport()->assertStatus(202);
        DB::rollBack();
        DB::commit();
        $this->assertDatabaseCount('data_export_requests', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('audit_events', 0);
        $this->assertSame($codes, $user->refresh()->recovery_codes);
        $this->assertSame(0, $this->published());
    }

    public function test_normal_request_publishes_one_job_after_its_business_commit(): void
    {
        $this->actor();
        $id = (int) $this->requestExport()->assertStatus(202)->json('export.id');
        $this->assertSame(0, DB::transactionLevel());
        $this->assertSame(1, $this->published());
        $this->queuedJob($id);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.data_export_requested')->count());
        $this->assertDatabaseCount('audit_outbox', 0);
    }

    public static function boundaries(): array
    {
        return [['normal'], ['outer']];
    }

    #[DataProvider('boundaries')]
    public function test_queue_outage_preserves_the_committed_recovery_marker_and_audit(string $boundary): void
    {
        config(['queue.connections.database.table' => 'export_queue_deliberately_absent_fixture']);
        $user = $this->actor();
        if ($boundary === 'outer') {
            DB::beginTransaction();
        }
        $id = (int) $this->requestExport()->assertStatus(202)->json('export.id');
        if ($boundary === 'outer') {
            DB::commit();
        }
        $this->assertDatabaseHas('data_export_requests', ['id' => $id, 'status' => 'processing', 'artifact_path' => null]);
        $this->assertSame([], $user->refresh()->recovery_codes);
        $this->assertSame(0, $this->published());
        $this->assertSame(1, OperationalMetrics::totals()['export.queue_unavailable']);
        foreach (['account.data_export_requested', 'account.data_export_queue_deferred'] as $action) {
            $this->assertSame(1, DB::table('audit_events')->where('action', $action)->count());
        }
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
    }

    public function test_cancellation_before_commit_is_harmless_to_a_later_delivered_job(): void
    {
        $this->actor();
        DB::beginTransaction();
        $id = (int) $this->requestExport()->assertStatus(202)->json('export.id');
        $this->postJson('/api/v1/auth/data-export/cancel')->assertOk();
        DB::commit();
        $this->assertSame(1, $this->published());
        $this->queuedJob($id)->handle();
        $this->assertDatabaseHas('data_export_requests', ['id' => $id, 'status' => 'cancelled', 'artifact_path' => null]);
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertSame([], Storage::disk('local')->files('account-exports'));
    }

    public function test_failed_business_audit_admission_never_publishes_a_job(): void
    {
        $user = $this->actor();
        $codes = $user->recovery_codes;
        $reject = true;
        DB::listen(static function (QueryExecuted $query) use (&$reject): void {
            if ($reject && str_starts_with($query->sql, 'insert into "audit_outbox"')) {
                throw new \RuntimeException('Fixture: business audit admission rejected');
            }
        });
        try {
            $this->requestExport()->assertStatus(500);
        } finally {
            $reject = false;
        }
        $this->assertSame($codes, $user->refresh()->recovery_codes);
        $this->assertDatabaseCount('data_export_requests', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertSame(0, $this->published());
    }
}
