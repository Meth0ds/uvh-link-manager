<?php

namespace Tests\Feature;

use App\Jobs\GenerateDataExportJob;
use App\Models\User;
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

    public function test_export_budget_and_sections_share_one_read_only_repeatable_read_snapshot(): void
    {
        $user = User::factory()->create();
        $method = new \ReflectionMethod(GenerateDataExportJob::class, 'buildConsistentPayload');
        $payload = $method->invoke(new GenerateDataExportJob(1), (int) $user->id);

        $this->assertIsArray($payload);
        $this->assertSame('uvh-account-export-v1', $payload['format']);
        $this->assertSame($user->id, $payload['account']->id);
        $this->assertSame(0, DB::transactionLevel());

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
}
