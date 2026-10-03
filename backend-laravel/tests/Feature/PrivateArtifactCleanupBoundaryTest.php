<?php

namespace Tests\Feature;

use App\Jobs\GenerateDataExportJob;
use App\Models\AccountRecoveryRequest;
use App\Models\DataExportRequest;
use App\Models\User;
use App\Support\Ids;
use App\Support\PrivateArtifact;
use App\Support\PrivateArtifactCleanup;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class PrivateArtifactCleanupBoundaryTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, mail_outbox, audit_events, audit_outbox, operational_metrics RESTART IDENTITY CASCADE');
        Storage::fake('local');
        Queue::fake();
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'artifact-boundary')->withHeader('X-CSRF-Token', 'artifact-boundary');
    }

    private function owner(): User
    {
        return User::factory()->create(['mfa_enabled' => true, 'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP')])->refresh();
    }

    private function ready(User $owner): DataExportRequest
    {
        $path = 'account-exports/'.Ids::randomToken(24).'.uvh';
        $stream = fopen('php://temp', 'r+b');
        fwrite($stream, '{"format":"fixture","private":"retained"}');
        rewind($stream);
        PrivateArtifact::write($path, $stream);
        fclose($stream);

        return DataExportRequest::create([
            'user_id' => $owner->id, 'security_version' => (int) $owner->security_version,
            'status' => 'ready', 'artifact_path' => $path, 'ready_at' => now(), 'download_expires_at' => now()->addDay(),
        ])->refresh();
    }

    private function operation(User $owner, string $flow): array
    {
        $token = Ids::randomToken(32);
        if ($flow === 'incident') {
            DB::table('email_tokens')->insert([
                'id' => Ids::sha256Hex($token), 'user_id' => $owner->id, 'kind' => 'security_revoke',
                'expires_at' => now()->addDay(), 'created_at' => now(),
            ]);

            return ['/api/v1/auth/security-incident/revoke', ['token' => $token]];
        }
        if ($flow === 'recovery') {
            $row = AccountRecoveryRequest::create([
                'user_id' => $owner->id, 'security_version' => (int) $owner->security_version, 'status' => 'approved',
                'completion_token_hash' => Ids::sha256Hex($token), 'completion_expires_at' => now()->addMinutes(30),
                'expires_at' => now()->addDay(),
            ]);
            foreach ([1, 2] as $index) {
                $admin = User::factory()->create(['is_admin' => true, 'mfa_enabled' => true]);
                DB::table('account_recovery_approvals')->insert([
                    'request_id' => $row->id, 'admin_user_id' => $admin->id,
                    'reason_code' => 'identity_verified_external', 'created_at' => now(),
                ]);
            }

            return ['/api/v1/auth/account-recovery/complete', ['token' => $token, 'password' => 'brujula-limonero-zafiro-93', 'confirmation' => 'RECUPERAR MI CUENTA']];
        }
        $session = SessionManager::create($owner->id, Request::create('/'), (int) $owner->security_version, true);
        $this->withCookie('uvh_session', $session);

        return ['/api/v1/auth/data-export/cancel', []];
    }

    public static function outerTransactions(): array
    {
        $cases = [];
        foreach (['incident', 'recovery', 'cancel'] as $flow) {
            foreach ([false, true] as $commit) {
                $cases[$flow.($commit ? ' commit' : ' rollback')] = [$flow, $commit];
            }
        }

        return $cases;
    }

    #[DataProvider('outerTransactions')]
    public function test_business_outer_transaction_never_deletes_the_file_before_commit(string $flow, bool $commit): void
    {
        $owner = $this->owner();
        $export = $this->ready($owner);
        $path = (string) $export->artifact_path;
        $before = $export->getRawOriginal();
        [$url, $payload] = $this->operation($owner, $flow);
        DB::beginTransaction();
        try {
            $this->postJson($url, $payload)->assertOk();
            $this->assertSame('cancelled', $export->refresh()->status);
            Storage::disk('local')->assertExists($path);
            $this->assertSame($path, $export->artifact_path);
            if ($commit) {
                DB::commit();
            } else {
                DB::rollBack();
            }
        } finally {
            if (DB::transactionLevel() > 0) {
                DB::rollBack();
            }
        }
        if ($commit) {
            Storage::disk('local')->assertMissing($path);
            $this->assertNull($export->refresh()->artifact_path);
        } else {
            Storage::disk('local')->assertExists($path);
            $this->assertSame($before, $export->refresh()->getRawOriginal());
        }
    }

    public static function diagnostics(): array
    {
        return [['incident', false], ['recovery', false], ['incident', true], ['recovery', true]];
    }

    #[DataProvider('diagnostics')]
    public function test_failed_cleanup_diagnostics_do_not_reject_confirmed_protection(string $flow, bool $metricsUnavailable): void
    {
        $owner = $this->owner();
        $export = $this->ready($owner);
        $path = (string) $export->artifact_path;
        [$url, $payload] = $this->operation($owner, $flow);
        $disk = Storage::disk('local');
        $proxy = \Mockery::mock($disk);
        $proxy->shouldReceive('delete')->with($path)->andReturn(false);
        $denyDeletion = true;
        Storage::shouldReceive('disk')->with('local')->andReturnUsing(static function () use ($disk, $proxy, &$denyDeletion) {
            return $denyDeletion ? $proxy : $disk;
        });
        $warningAttempted = false;
        Log::listen(static function (MessageLogged $event) use (&$warningAttempted): void {
            if (in_array($event->message, ['Private export artifact cleanup failed', '[metrics] counter write unavailable'], true)) {
                $warningAttempted = true;
                throw new \RuntimeException('Fixture: diagnostics transport unavailable');
            }
        });
        if ($metricsUnavailable) {
            Schema::rename('operational_metrics', 'operational_metrics_unavailable');
        }
        try {
            $response = $this->postJson($url, $payload);
            $this->assertTrue($warningAttempted);
            $response->assertOk();
            $this->assertSame(2, $owner->refresh()->security_version);
            $this->assertSame('cancelled', $export->refresh()->status);
            $this->assertSame($path, $export->artifact_path);
            $this->assertTrue($disk->exists($path));
        } finally {
            $denyDeletion = false;
            if ($metricsUnavailable) {
                Schema::rename('operational_metrics_unavailable', 'operational_metrics');
            }
        }
        // The saved concrete pointer is the recovery evidence, not a log line.
        PrivateArtifactCleanup::retryTerminal();
        $this->assertFalse($disk->exists($path));
        $this->assertNull($export->refresh()->artifact_path);
    }

    public static function auditFailures(): array
    {
        return [['php'], ['sql']];
    }

    #[DataProvider('auditFailures')]
    public function test_ready_export_and_notice_roll_back_when_exact_audit_admission_fails(string $failure): void
    {
        $owner = $this->owner();
        $export = DataExportRequest::create(['user_id' => $owner->id, 'security_version' => 1, 'status' => 'processing']);
        $fail = true;
        if ($failure === 'sql') {
            Schema::rename('audit_outbox', 'audit_outbox_unavailable');
        } else {
            DB::listen(static function (QueryExecuted $query) use (&$fail): void {
                if ($fail && str_starts_with($query->sql, 'insert into "audit_outbox"')) {
                    foreach ($query->bindings as $binding) {
                        if (is_string($binding) && str_contains($binding, '"action":"account.data_export_ready"')) {
                            throw new \RuntimeException('Fixture: exact ready audit admission unavailable');
                        }
                    }
                }
            });
        }
        try {
            $thrown = null;
            try {
                (new GenerateDataExportJob((int) $export->id))->handle();
            } catch (\Throwable $error) {
                $thrown = $error;
            }
            if ($thrown === null) {
                // Characterize the original boundary: Audit::write absorbs an
                // admission failure outside the ready business transaction.
                $this->assertSame('ready', $export->refresh()->status);
                Storage::disk('local')->assertExists((string) $export->artifact_path);
                $this->assertDatabaseCount('mail_outbox', 1);
                $this->assertDatabaseCount('notifications', 1);
                $this->assertSame(0, DB::table('audit_events')->where('action', 'account.data_export_ready')->count());
                if ($failure === 'php') {
                    $this->assertDatabaseCount('audit_outbox', 0);
                }
            }
            $this->assertNotNull($thrown);
            $this->assertSame('processing', $export->refresh()->status);
            $this->assertNull($export->artifact_path);
            $this->assertDatabaseCount('mail_outbox', 0);
            $this->assertDatabaseCount('notifications', 0);
            $this->assertSame([], Storage::disk('local')->files('account-exports'));
        } finally {
            $fail = false;
            if ($failure === 'sql') {
                Schema::rename('audit_outbox_unavailable', 'audit_outbox');
            }
        }
        (new GenerateDataExportJob((int) $export->id))->handle();
        $this->assertSame('ready', $export->refresh()->status);
        Storage::disk('local')->assertExists((string) $export->artifact_path);
        $this->assertDatabaseCount('mail_outbox', 1);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.data_export_ready')->count());
    }

    public static function staleStates(): array
    {
        return [['ready'], ['processing'], ['changed_path'], ['missing']];
    }

    #[DataProvider('staleStates')]
    public function test_deferred_cleanup_rechecks_the_committed_row(string $state): void
    {
        $owner = $this->owner();
        $export = $this->ready($owner);
        $path = (string) $export->artifact_path;
        $replacement = $this->ready($this->owner());
        $replacementPath = (string) $replacement->artifact_path;
        DB::transaction(function () use ($export, $path, $state, $replacementPath): void {
            $export->update(['status' => 'cancelled']);
            PrivateArtifactCleanup::afterCommit((int) $export->id, $path);
            if ($state === 'missing') {
                $export->delete();
            } elseif ($state === 'changed_path') {
                $export->update(['artifact_path' => $replacementPath]);
            } else {
                $export->update(['status' => $state]);
            }
        });
        Storage::disk('local')->assertExists($path);
        Storage::disk('local')->assertExists($replacementPath);
    }

    public function test_rolled_back_savepoint_discards_cleanup_even_when_parent_commits(): void
    {
        $export = $this->ready($this->owner());
        $path = (string) $export->artifact_path;
        DB::beginTransaction();
        try {
            DB::beginTransaction();
            $export->update(['status' => 'cancelled']);
            PrivateArtifactCleanup::afterCommit((int) $export->id, $path);
            DB::rollBack();
            DB::commit();
        } finally {
            while (DB::transactionLevel() > 0) {
                DB::rollBack();
            }
        }
        $this->assertSame('ready', $export->refresh()->status);
        Storage::disk('local')->assertExists($path);
    }

    public function test_terminal_retry_rechecks_a_row_changed_after_selection(): void
    {
        $export = $this->ready($this->owner());
        $path = (string) $export->artifact_path;
        $export->update(['status' => 'cancelled']);
        $changed = false;
        DB::listen(static function (QueryExecuted $query) use (&$changed, $export): void {
            if (! $changed && str_starts_with($query->sql, 'select')
                && str_contains($query->sql, '"data_export_requests"')
                && str_contains($query->sql, 'order by "updated_at"')) {
                $changed = true;
                DB::table('data_export_requests')->where('id', $export->id)->update(['status' => 'ready']);
            }
        });
        $this->assertSame(0, PrivateArtifactCleanup::retryTerminal());
        $this->assertTrue($changed);
        $this->assertSame('ready', $export->refresh()->status);
        Storage::disk('local')->assertExists($path);
    }

    public function test_worker_cleanup_reports_the_actual_outcome_before_replacing_a_path(): void
    {
        $export = $this->ready($this->owner());
        $path = (string) $export->artifact_path;
        $export->update(['status' => 'processing']);
        $disk = Storage::disk('local');
        $proxy = \Mockery::mock($disk);
        $proxy->shouldReceive('delete')->with($path)->andReturn(false);
        $denyDeletion = true;
        Storage::shouldReceive('disk')->with('local')->andReturnUsing(static function () use ($disk, $proxy, &$denyDeletion) {
            return $denyDeletion ? $proxy : $disk;
        });
        $this->assertFalse(PrivateArtifactCleanup::attempt((int) $export->id, $path));
        $this->assertSame($path, $export->refresh()->artifact_path);
        $this->assertTrue($disk->exists($path));
        $denyDeletion = false;
        $this->assertTrue(PrivateArtifactCleanup::attempt((int) $export->id, $path));
        $this->assertNull($export->refresh()->artifact_path);
        $this->assertFalse($disk->exists($path));
    }

    public function test_pointer_clear_failure_retains_evidence_and_retry_is_idempotent(): void
    {
        $export = $this->ready($this->owner());
        $path = (string) $export->artifact_path;
        $export->update(['status' => 'cancelled']);
        $fail = true;
        DB::listen(static function (QueryExecuted $query) use (&$fail): void {
            if ($fail && str_starts_with($query->sql, 'update "data_export_requests"')
                && in_array(null, $query->bindings, true)) {
                throw new \RuntimeException('Fixture: pointer update interrupted');
            }
        });
        PrivateArtifactCleanup::afterCommit((int) $export->id, $path);
        Storage::disk('local')->assertMissing($path);
        $this->assertSame($path, $export->refresh()->artifact_path);
        $this->assertSame('cancelled', $export->status);
        $fail = false;
        $this->assertSame(1, PrivateArtifactCleanup::retryTerminal());
        $this->assertNull($export->refresh()->artifact_path);
        $this->assertSame(0, PrivateArtifactCleanup::retryTerminal());
    }

    public static function invalidPaths(): array
    {
        return [['../private.txt'], ['account-exports/../private.txt'], ['account-exports/'.str_repeat('A', 32).'.uvh/extra'], ['account-exports/'.str_repeat('A', 32).".uvh\n"]];
    }

    #[DataProvider('invalidPaths')]
    public function test_invalid_paths_remain_rejected_when_warning_transport_fails(string $path): void
    {
        $export = $this->ready($this->owner());
        $validPath = (string) $export->artifact_path;
        Log::listen(static function (MessageLogged $event): void {
            if ($event->message === 'Rejected invalid private export artifact path') {
                throw new \RuntimeException('Fixture: log unavailable');
            }
        });
        $this->assertFalse(PrivateArtifactCleanup::attempt((int) $export->id, $path));
        $this->assertSame($validPath, $export->refresh()->artifact_path);
        Storage::disk('local')->assertExists($validPath);
    }

    public function test_housekeeping_recovers_a_committed_terminal_pointer_once(): void
    {
        $export = $this->ready($this->owner());
        $path = (string) $export->artifact_path;
        $export->update(['status' => 'cancelled']);
        // Model a process ending after commit and before its callback ran.
        Cache::forget('uvh:housekeeping:last_heavy');
        $this->assertSame(0, Artisan::call('uvh:housekeeping'));
        $this->assertNull($export->refresh()->artifact_path);
        Storage::disk('local')->assertMissing($path);
        $count = (int) DB::table('operational_metrics')->where('metric', 'export.cleaned')->sum('count');
        $this->assertSame(1, $count);
        Cache::forget('uvh:housekeeping:last_heavy');
        $this->assertSame(0, Artisan::call('uvh:housekeeping'));
        $this->assertSame($count, (int) DB::table('operational_metrics')->where('metric', 'export.cleaned')->sum('count'));
    }
}
