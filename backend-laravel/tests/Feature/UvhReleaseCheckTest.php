<?php

namespace Tests\Feature;

use App\Support\ReleaseReadiness;
use Illuminate\Database\Migrations\Migrator;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Mockery;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Prepared only: requires a fully migrated PostgreSQL *_test database. */
final class UvhReleaseCheckTest extends TestCase
{
    public function test_ready_release_does_not_change_ledger_or_reserve_mail_budget(): void
    {
        $ledger = DB::table('migrations')->orderBy('id')->get()->toArray();
        $this->assertSame([], ReleaseReadiness::errors());
        $this->artisan('uvh:release-check')->assertExitCode(0);
        foreach (['app', 'queue', 'scheduler'] as $component) {
            Cache::put('uvh:health:'.$component, time(), 300);
            $this->artisan('uvh:healthcheck', ['component' => $component])->assertExitCode(0);
        }
        $this->assertEquals($ledger, DB::table('migrations')->orderBy('id')->get()->toArray());
        $this->assertSame(0, DB::table('invitation_mail_budgets')->count());
    }

    public function test_existing_table_does_not_hide_a_pending_migration(): void
    {
        DB::beginTransaction();
        try {
            $this->assertSame(1, DB::table('migrations')->where(
                'migration', '2026_09_05_000032_create_invitation_mail_budgets',
            )->delete());
            $this->assertContains('Hay 1 migraciones pendientes para esta imagen.', ReleaseReadiness::errors());
            $this->assertRuntimeUnready();
            // Inspection must not repair the ledger behind the operator's back.
            $this->assertFalse(DB::table('migrations')->where(
                'migration', '2026_09_05_000032_create_invitation_mail_budgets',
            )->exists());
        } finally {
            DB::rollBack();
        }
    }

    public static function missingSchema(): array
    {
        return [['ledger'], ['table'], ['column'], ['audit_column']];
    }

    #[DataProvider('missingSchema')]
    public function test_schema_drift_is_not_hidden_by_connectivity_or_heartbeats(string $part): void
    {
        // PostgreSQL DDL is transactional. Always restore the complete fixture,
        // even after an assertion fails; parent setUp already enforces *_test.
        DB::beginTransaction();
        try {
            if ($part === 'ledger') {
                Schema::rename('migrations', 'release_check_hidden_migrations');
            } elseif ($part === 'table') {
                Schema::rename('invitation_mail_budgets', 'release_check_hidden_budgets');
            } elseif ($part === 'audit_column') {
                Schema::table('audit_events', function (Blueprint $table): void {
                    $table->renameColumn('workspace_id', 'release_check_hidden_workspace');
                });
            } else {
                Schema::table('invitation_mail_budgets', function (Blueprint $table): void {
                    $table->renameColumn('used', 'release_check_hidden_used');
                });
            }
            $expected = match ($part) {
                'ledger' => 'Falta el registro de migraciones. Ejecuta la migración del release de forma autorizada.',
                'audit_column' => 'Falta la atribución de actividad por workspace (000033).',
                default => 'Falta el esquema de presupuestos de invitación (000032).',
            };
            $this->assertContains($expected, ReleaseReadiness::errors());
            $this->assertRuntimeUnready();
            // A missing ledger must remain missing: this command never installs it.
            if ($part === 'ledger') {
                $this->assertFalse(Schema::hasTable('migrations'));
            }
        } finally {
            DB::rollBack();
        }
        $this->assertSame([], ReleaseReadiness::errors());
    }

    public function test_invalid_budget_configuration_blocks_readiness_without_admission(): void
    {
        config(['uvh.invitation_mail_budget.recipient_day' => 0]);
        $this->assertContains('Configuración de presupuestos de invitación inválida.', ReleaseReadiness::errors());
        $this->assertRuntimeUnready();
        $this->assertSame(0, DB::table('invitation_mail_budgets')->count());
    }

    public function test_schema_inspection_failure_is_closed_and_does_not_expose_exception_details(): void
    {
        $migrator = Mockery::mock(Migrator::class);
        $migrator->shouldReceive('paths')->andThrow(new \RuntimeException('Fixture sensitive connection detail'));
        $this->app->instance('migrator', $migrator);
        $this->assertSame(['No se pudo comprobar el esquema del release.'], ReleaseReadiness::errors());
        $this->assertRuntimeUnready();
    }

    private function assertRuntimeUnready(): void
    {
        $this->artisan('uvh:release-check')->assertExitCode(1);
        foreach (['app', 'queue', 'scheduler'] as $component) {
            // Fresh process signals cannot override an incompatible schema.
            Cache::put('uvh:health:'.$component, time(), 300);
            $this->artisan('uvh:healthcheck', ['component' => $component])->assertExitCode(1);
        }
    }
}
