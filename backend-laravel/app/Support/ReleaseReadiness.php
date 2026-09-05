<?php

namespace App\Support;

use Illuminate\Database\Migrations\Migrator;
use Illuminate\Support\Facades\Schema;

/** Read-only deployment prerequisites; not proof of full production readiness. */
final class ReleaseReadiness
{
    /** @return list<string> Safe messages: never expose connection details or SQL. */
    public static function errors(): array
    {
        $errors = [];
        try {
            InvitationMailBudget::limits();
        } catch (\Throwable) {
            $errors[] = 'Configuración de presupuestos de invitación inválida.';
        }
        try {
            /** @var Migrator $migrator */
            $migrator = app('migrator');
            // Enumerate packaged files, including registered package paths.
            // Never resolve/execute migration classes or create their repository.
            $files = $migrator->getMigrationFiles([...$migrator->paths(), database_path('migrations')]);
            if ($files === []) {
                $errors[] = 'La imagen no contiene las migraciones del release.';
            }
            if (! $migrator->repositoryExists()) {
                $errors[] = 'Falta el registro de migraciones. Ejecuta la migración del release de forma autorizada.';
            } else {
                $pending = array_diff(array_keys($files), $migrator->getRepository()->getRan());
                if ($pending !== []) {
                    $errors[] = 'Hay '.count($pending).' migraciones pendientes para esta imagen.';
                }
            }
            // A ledger entry alone cannot prove the critical new table exists:
            // catch partial/manual schema restoration without reading its contents.
            if (! Schema::hasColumns('invitation_mail_budgets', ['budget_key', 'used', 'expires_at_epoch'])) {
                $errors[] = 'Falta el esquema de presupuestos de invitación (000032).';
            }
            if (! Schema::hasColumn('audit_events', 'workspace_id')) {
                $errors[] = 'Falta la atribución de actividad por workspace (000033).';
            }
        } catch (\Throwable) {
            $errors[] = 'No se pudo comprobar el esquema del release.';
        }
        return $errors;
    }
}
