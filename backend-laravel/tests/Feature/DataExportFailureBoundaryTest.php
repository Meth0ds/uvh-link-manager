<?php

namespace Tests\Feature;

use App\Jobs\GenerateDataExportJob;
use App\Models\DataExportRequest;
use App\Models\User;
use App\Support\Audit;
use App\Support\PrivateArtifact;
use App\Support\PrivateArtifactCleanup;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Terminal generation boundaries on a guarded test DB and fake private volume. */
final class DataExportFailureBoundaryTest extends TestCase
{
    private const PATH = 'account-exports/CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC.uvh';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox, mail_outbox, operational_metrics RESTART IDENTITY CASCADE');
        Storage::fake('local');
    }

    private function processing(string $flow): DataExportRequest
    {
        $user = User::factory()->create(['email_verified_at' => now()]);
        $row = DataExportRequest::create([
            'user_id' => $user->id, 'security_version' => (int) $user->security_version,
            'status' => 'processing', 'stage' => 'collecting',
        ]);
        if ($flow === 'failed') {
            $plain = fopen('php://temp', 'r+b');
            fwrite($plain, '{"fixture":"interrupted export"}');
            rewind($plain);
            PrivateArtifact::write(self::PATH, $plain);
            fclose($plain);
            $row->update(['artifact_path' => self::PATH]);
        } else {
            config(['uvh.export_max_plaintext_bytes' => 1024]);
        }

        return $row;
    }

    private function terminate(DataExportRequest $row, string $flow): void
    {
        $job = new GenerateDataExportJob((int) $row->id);
        if ($flow === 'failed') {
            $job->failed(new \RuntimeException('Fixture: exhausted generation retries'));
        } else {
            $job->handle();
        }
    }

    public static function admissions(): array
    {
        return [['failed', 'php'], ['failed', 'sql'], ['size', 'php'], ['size', 'sql']];
    }

    #[DataProvider('admissions')]
    public function test_terminal_state_rolls_back_when_its_exact_audit_cannot_be_admitted(string $flow, string $mode): void
    {
        $row = $this->processing($flow);
        $reject = true;
        if ($mode === 'sql') {
            Schema::rename('audit_outbox', 'audit_outbox_export_failure_absent');
        } else {
            DB::listen(static function (QueryExecuted $query) use (&$reject): void {
                if (! $reject || ! str_starts_with($query->sql, 'insert into "audit_outbox"')) {
                    return;
                }
                foreach ($query->bindings as $binding) {
                    if (is_string($binding) && str_contains($binding, '"action":"account.data_export_failed"')) {
                        throw new \RuntimeException('Fixture: exact terminal event admission unavailable');
                    }
                }
            });
        }
        $thrown = null;
        try {
            try {
                $this->terminate($row, $flow);
            } catch (\Throwable $error) {
                $thrown = $error;
            }
        } finally {
            $reject = false;
            if ($mode === 'sql') {
                Schema::rename('audit_outbox_export_failure_absent', 'audit_outbox');
            }
        }
        $this->assertNotNull($thrown, 'The terminal mutation must not commit without its durable event');
        $this->assertSame('processing', $row->refresh()->status);
        $this->assertNull($row->failure_reason);
        $this->assertNotNull($row->artifact_path, 'The registered cleanup evidence survives a failed transition');
        if ($flow === 'failed') {
            Storage::disk('local')->assertExists(self::PATH);
        }
        $this->assertSame(0, DB::table('audit_events')->where('action', 'account.data_export_failed')->count());
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->terminate($row, $flow);
        $this->assertSame('failed', $row->refresh()->status);
        $this->assertNull($row->artifact_path);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.data_export_failed')->count());
    }

    public static function flows(): array
    {
        return [['failed'], ['size']];
    }

    #[DataProvider('flows')]
    public function test_terminal_success_is_durable_and_duplicate_execution_does_not_repeat_the_event(string $flow): void
    {
        $row = $this->processing($flow);
        $this->terminate($row, $flow);
        $this->assertSame('failed', $row->refresh()->status);
        $this->assertSame($flow === 'size' ? 'automated_size_limit' : 'generation_error', $row->failure_reason);
        $this->assertNull($row->stage);
        $this->assertNull($row->artifact_path);
        $this->assertSame([], Storage::disk('local')->files('account-exports'));
        $event = DB::table('audit_events')->where('action', 'account.data_export_failed')->sole();
        $this->assertSame((string) $row->id, $event->resource_id);
        $this->assertSame((int) $row->user_id, (int) $event->user_id);
        $this->terminate($row, $flow);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.data_export_failed')->count());
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
    }

    public static function commits(): array
    {
        return [[false], [true]];
    }

    #[DataProvider('commits')]
    public function test_exhausted_retry_cleanup_waits_for_the_outer_commit(bool $commit): void
    {
        $row = $this->processing('failed');
        DB::beginTransaction();
        try {
            $this->terminate($row, 'failed');
            $this->assertSame('failed', $row->refresh()->status);
            $this->assertSame(self::PATH, $row->artifact_path);
            Storage::disk('local')->assertExists(self::PATH);
            $this->assertDatabaseCount('audit_outbox', 1);
            $this->assertSame(0, DB::table('audit_events')->where('action', 'account.data_export_failed')->count());
            if ($commit) {
                DB::commit();
            } else {
                DB::rollBack();
            }
        } finally {
            while (DB::transactionLevel() > 0) {
                DB::rollBack();
            }
        }
        $this->assertSame($commit ? 'failed' : 'processing', $row->refresh()->status);
        $this->assertSame($commit ? null : self::PATH, $row->artifact_path);
        $this->assertSame(! $commit, Storage::disk('local')->exists(self::PATH));
        $this->assertSame($commit ? 1 : 0, DB::table('audit_events')->where('action', 'account.data_export_failed')->count());
        $this->assertDatabaseCount('audit_outbox', 0);
    }

    #[DataProvider('flows')]
    public function test_cleanup_outage_keeps_the_terminal_pointer_until_retry_confirms_absence(string $flow): void
    {
        $row = $this->processing($flow);
        $disk = Storage::disk('local');
        $proxy = \Mockery::mock($disk);
        if ($flow === 'failed') {
            $proxy->shouldReceive('delete')->with(self::PATH)->andReturn(false);
        } else {
            // Size refusal precedes writing bytes. An unavailable volume still
            // cannot confirm absence; do not invent a private-file leak here.
            $proxy->shouldReceive('exists')->andThrow(new \RuntimeException('Fixture: private volume unavailable'));
        }
        $outage = true;
        Storage::shouldReceive('disk')->with('local')->andReturnUsing(static function () use (&$outage, $proxy, $disk) {
            return $outage ? $proxy : $disk;
        });
        try {
            $this->terminate($row, $flow);
            $this->assertSame('failed', $row->refresh()->status);
            $this->assertTrue(PrivateArtifactCleanup::isManagedPath($row->artifact_path));
            if ($flow === 'failed') {
                $this->assertTrue($disk->exists(self::PATH));
            } else {
                $this->assertSame([], $disk->files('account-exports'));
            }
            $this->assertSame(1, DB::table('audit_events')->where('action', 'account.data_export_failed')->count());
        } finally {
            $outage = false;
        }
        $this->assertSame(1, PrivateArtifactCleanup::retryTerminal());
        $this->assertNull($row->refresh()->artifact_path);
        $this->assertSame([], $disk->files('account-exports'));
        $this->assertSame(0, PrivateArtifactCleanup::retryTerminal());
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.data_export_failed')->count());
    }

    public static function terminalStates(): array
    {
        return [['ready'], ['downloaded'], ['cancelled'], ['expired'], ['missing']];
    }

    #[DataProvider('terminalStates')]
    public function test_stale_failed_callback_does_not_overwrite_a_non_processing_request(string $status): void
    {
        $row = $this->processing('failed');
        if ($status === 'missing') {
            $row->delete();
        } else {
            $row->update(['status' => $status]);
        }
        $before = DB::table('data_export_requests')->get()->toJson();
        $this->terminate($row, 'failed');
        $this->assertSame($before, DB::table('data_export_requests')->get()->toJson());
        Storage::disk('local')->assertExists(self::PATH);
        $this->assertDatabaseCount('audit_events', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
    }

    #[DataProvider('flows')]
    public function test_materialization_failure_preserves_the_exact_terminal_event_for_recovery(string $flow): void
    {
        $row = $this->processing($flow);
        $reject = true;
        DB::listen(static function (QueryExecuted $query) use (&$reject): void {
            if ($reject && str_starts_with($query->sql, 'insert into "audit_events"')
                && in_array('account.data_export_failed', $query->bindings, true)) {
                throw new \RuntimeException('Fixture: terminal event materialization unavailable');
            }
        });
        try {
            $this->terminate($row, $flow);
            $this->assertSame('failed', $row->refresh()->status);
            $this->assertDatabaseCount('audit_outbox', 1);
            $event = json_decode(DB::table('audit_outbox')->value('event'), true, 32, JSON_THROW_ON_ERROR);
            $this->assertSame('account.data_export_failed', $event['action']);
            $this->assertSame((string) $row->id, $event['resource_id']);
            $this->assertNull($row->artifact_path);
        } finally {
            $reject = false;
        }
        $this->assertTrue(Audit::drain());
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.data_export_failed')->count());
        $this->assertTrue(Audit::drain());
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.data_export_failed')->count());
    }
}
