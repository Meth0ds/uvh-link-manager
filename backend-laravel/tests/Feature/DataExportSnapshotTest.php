<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\AccountExportDocument;
use App\Support\ExportTooLarge;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Regression contract; the parent guard permits destructive setup only on *_test. */
final class DataExportSnapshotTest extends TestCase
{
    /** @var list<array{sql: string, level: int}> */
    private array $queries = [];

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, operational_metrics RESTART IDENTITY CASCADE');
        DB::listen(function (QueryExecuted $event): void {
            $this->queries[] = [
                'sql' => strtolower($event->sql),
                'level' => $event->connection->transactionLevel(),
            ];
        });
    }

    public function test_export_sections_share_one_read_only_repeatable_read_snapshot(): void
    {
        $user = User::factory()->create();
        $out = fopen('php://temp/maxmemory:2097152', 'r+b');
        $this->assertIsResource($out);
        $phases = [];
        $bytes = AccountExportDocument::render((int) $user->id, $out, function (string $phase) use (&$phases): void {
            $phases[] = $phase;
        });
        rewind($out);
        $document = (string) stream_get_contents($out);
        fclose($out);

        $decoded = json_decode($document, true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame('uvh-account-export-v1', $decoded['format']);
        $this->assertSame($user->email, $decoded['account']['email']);
        // El documento declara sobre sí mismo la separación contractual: es la
        // copia de acceso de la cuenta, no el ejercicio de un derecho formal.
        $this->assertSame('account_access_copy', $decoded['rights']['document']);
        $this->assertIsArray($decoded['memberships']);
        $this->assertIsArray($decoded['aggregateAnalytics']);
        $this->assertSame($bytes, strlen($document));
        $this->assertSame(0, DB::transactionLevel());

        // El pipeline se anuncia completo y en orden: recogida, analítica y
        // codificación; el job añade cifrado y remate sobre esto.
        $this->assertSame(['collecting', 'analytics', 'encoding'], $phases);

        $isolation = collect($this->queries)->first(
            fn (array $query): bool => str_contains($query['sql'], 'set transaction isolation level repeatable read read only'),
        );
        $this->assertNotNull($isolation);
        $this->assertSame(1, $isolation['level']);

        $snapshotReads = collect($this->queries)->filter(
            fn (array $query): bool => str_starts_with($query['sql'], 'select')
                && (str_contains($query['sql'], '"users"') || str_contains($query['sql'], '"memberships"')),
        );
        $this->assertNotEmpty($snapshotReads);
        $this->assertTrue($snapshotReads->every(fn (array $query): bool => $query['level'] === 1));
    }

    public function test_the_document_ceiling_stops_an_oversized_export_with_the_size_reason(): void
    {
        $user = User::factory()->create();
        config(['uvh.export_max_plaintext_bytes' => 1024]);
        $out = fopen('php://temp/maxmemory:2097152', 'r+b');
        $this->assertIsResource($out);

        try {
            AccountExportDocument::render((int) $user->id, $out, null);
            $this->fail('a document over the ceiling must refuse');
        } catch (ExportTooLarge) {
            $this->addToAssertionCount(1);
        } finally {
            fclose($out);
        }
    }
}
