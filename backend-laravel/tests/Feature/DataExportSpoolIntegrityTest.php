<?php

namespace Tests\Feature;

use App\Jobs\GenerateDataExportJob;
use App\Models\DataExportRequest;
use App\Models\LegalAcceptance;
use App\Models\User;
use App\Support\PrivateArtifact;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Tests\Fixtures\ExportFragmentFault;
use Tests\Fixtures\ExportIoStream;
use Tests\TestCase;

/** Test-only namespaced fopen affects only this process and the fragment allocation site. */
#[RunTestsInSeparateProcesses]
#[PreserveGlobalState(false)]
final class DataExportSpoolIntegrityTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox, mail_outbox, operational_metrics RESTART IDENTITY CASCADE');
        Storage::fake('local');
    }

    public static function faults(): array
    {
        return [
            'account read fails before first byte' => [1, 'read-error'],
            'legal read fails after first row' => [13, 'partial-read'],
            'account rewind fails' => [1, 'rewind-error'],
            'legal rewind fails' => [13, 'rewind-error'],
            'normal account EOF' => [1, 'normal'],
            'normal legal EOF' => [13, 'normal'],
            'first allocation throws' => [1, 'allocation-error'],
            'middle allocation throws' => [7, 'allocation-error'],
            'last allocation throws' => [13, 'allocation-error'],
            'middle allocation returns false' => [7, 'allocation-false'],
        ];
    }

    #[DataProvider('faults')]
    public function test_public_generation_never_publishes_an_incomplete_spool_and_closes_partial_allocations(int $ordinal, string $fault): void
    {
        $user = User::factory()->create(['email_verified_at' => now()]);
        foreach (['terms', 'privacy_notice'] as $type) {
            LegalAcceptance::create(['user_id' => $user->id, 'document_type' => $type, 'version' => 'fixture-v1', 'source' => 'registration', 'accepted_at' => now()]);
        }
        $row = DataExportRequest::create(['user_id' => $user->id, 'security_version' => (int) $user->security_version, 'status' => 'processing']);
        require __DIR__.'/../Support/export-fragment-io.php';
        stream_wrapper_register('uvh-export-fragment', ExportIoStream::class);
        ExportIoStream::$initialContents = '';
        ExportIoStream::$readFailureAfter = match ($fault) {
            'read-error' => 0,
            'partial-read' => -1,
            default => null,
        };
        ExportIoStream::$denyRewind = $fault === 'rewind-error';
        ExportFragmentFault::$selected = $ordinal;
        ExportFragmentFault::$fault = $fault;
        ExportFragmentFault::$enabled = true;
        $thrown = null;
        try {
            try {
                (new GenerateDataExportJob((int) $row->id))->handle();
            } catch (\Throwable $error) {
                $thrown = $error;
            }
            ExportFragmentFault::$enabled = false;
            if ($fault === 'normal') {
                $this->assertNull($thrown);
                $this->assertSame('ready', $row->refresh()->status);
                $cipher = Storage::disk('local')->readStream($row->artifact_path);
                try {
                    $contents = implode('', iterator_to_array(PrivateArtifact::readChunks($cipher), false));
                } finally {
                    fclose($cipher);
                }
                $document = json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
                $this->assertSame((int) $user->id, (int) $document['account']['id']);
                $this->assertCount(2, $document['legalAcceptances']);
                $this->assertSame(1, DB::table('audit_events')->where('action', 'account.data_export_ready')->count());
                $this->assertDatabaseCount('mail_outbox', 1);
                $this->assertDatabaseCount('notifications', 1);
            } else {
                if ($thrown === null) {
                    // Record the actual original defect before failing the
                    // required invariant: ready notices announce missing data.
                    $this->assertSame('ready', $row->refresh()->status);
                    $cipher = Storage::disk('local')->readStream($row->artifact_path);
                    try {
                        $damaged = json_decode(implode('', iterator_to_array(PrivateArtifact::readChunks($cipher), false)), true, 512, JSON_THROW_ON_ERROR);
                    } finally {
                        fclose($cipher);
                    }
                    if ($ordinal === 1) {
                        $this->assertNull($damaged['account']);
                    } else {
                        $this->assertCount($fault === 'partial-read' ? 1 : 0, $damaged['legalAcceptances']);
                    }
                    $this->assertDatabaseCount('mail_outbox', 1);
                    $this->assertDatabaseCount('notifications', 1);
                }
                $this->assertNotNull($thrown, 'Failed spool I/O must not become a ready, authenticated but incomplete document');
                $this->assertSame('processing', $row->refresh()->status);
                $this->assertNull($row->artifact_path);
                $this->assertNull($row->ready_at);
                $this->assertSame([], Storage::disk('local')->files('account-exports'));
                $this->assertSame(0, DB::table('audit_events')->where('action', 'account.data_export_ready')->count());
                $this->assertDatabaseCount('mail_outbox', 0);
                $this->assertDatabaseCount('notifications', 0);
            }
            foreach (ExportFragmentFault::$opened as $resource) {
                $this->assertFalse(is_resource($resource), 'Every successfully opened fragment closes even if a later allocation throws');
            }
            if ($fault !== 'normal') {
                // A failed generation is retryable; the test hook remains
                // loaded but disabled, so this uses the unmodified real volume.
                (new GenerateDataExportJob((int) $row->id))->handle();
                $this->assertSame('ready', $row->refresh()->status);
                $this->assertSame(1, DB::table('audit_events')->where('action', 'account.data_export_ready')->count());
                $this->assertDatabaseCount('mail_outbox', 1);
                $this->assertDatabaseCount('notifications', 1);
            }
        } finally {
            ExportFragmentFault::$enabled = false;
            foreach (ExportFragmentFault::$opened as $resource) {
                if (is_resource($resource)) {
                    fclose($resource);
                }
            }
            stream_wrapper_unregister('uvh-export-fragment');
        }
    }
}
