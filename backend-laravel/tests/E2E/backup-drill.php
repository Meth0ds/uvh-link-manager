<?php

declare(strict_types=1);

/**
 * Drill helper for the backup and restore harness.
 *
 * Subcommands:
 *   seed            create a deterministic dataset (idempotent) and print it
 *   seed-extra      add records that a backup taken earlier cannot contain
 *   fingerprint     per-table row counts plus a content digest of key tables
 *   damage <table>  truncate a table, modelling data loss without schema loss
 *   drift <table>   drop a table, modelling a damaged schema
 *   unledger <n>    rewind the migrations ledger by n rows, modelling a restore
 *                   of a backup taken before the current release
 *
 * A fingerprint is intentionally blunt: the harness must not be able to claim
 * that a restore succeeded because a table merely still exists.
 */

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$database = (string) config('database.connections.'.config('database.default').'.database');
if (! app()->environment('testing') || ! str_ends_with($database, '_test')) {
    fwrite(STDERR, "Refusing to run backup drills outside APP_ENV=testing and a _test database.\n");
    exit(64);
}

$fingerprint = static function (): array {
    $counts = [];
    foreach (DB::table('pg_tables')->where('schemaname', 'public')->orderBy('tablename')->pluck('tablename')->all() as $table) {
        $counts[$table] = (int) DB::table($table)->count();
    }
    $content = [];
    foreach (['users', 'links', 'workspaces', 'custom_domains', 'audit_events'] as $table) {
        if (! DB::getSchemaBuilder()->hasTable($table) || ! DB::getSchemaBuilder()->hasColumn($table, 'id')) {
            continue;
        }
        $ids = DB::table($table)->orderBy('id')->pluck('id')->all();
        $content[$table] = hash('sha256', implode(',', array_map('strval', $ids)));
    }

    return ['counts' => $counts, 'content' => $content];
};

$seed = static function (int $count, string $mark): array {
    $now = now();
    $created = 0;
    for ($i = 1; $i <= $count; $i++) {
        $suffix = $mark.'-'.$i;
        $userId = DB::table('users')->insertGetId([
            'name' => 'Drill '.$suffix,
            'email' => 'drill-'.$suffix.'@example.test',
            'password_hash' => 'drill-not-a-real-hash',
            'is_admin' => false,
            'mfa_enabled' => false,
            'security_version' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $workspaceId = DB::table('workspaces')->insertGetId([
            'name' => 'Drill workspace '.$suffix,
            'slug' => 'drill-'.$suffix,
            'owner_user_id' => $userId,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        // memberships is insert-only: it has created_at but no updated_at.
        DB::table('memberships')->insert([
            'workspace_id' => $workspaceId,
            'user_id' => $userId,
            'role' => 'owner',
            'created_at' => $now,
        ]);
        DB::table('links')->insert([
            'workspace_id' => $workspaceId,
            'created_by' => $userId,
            'alias' => 'drill-'.$suffix,
            'destination' => 'https://example.test/'.$suffix,
            'state' => 'active',
            'click_count' => 0,
            'single_use' => false,
            'password_version' => 1,
            'version' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $created += 4;
    }

    return ['mark' => $mark, 'rows' => $created];
};

$command = (string) ($argv[1] ?? '');
$argument = (string) ($argv[2] ?? '');

$output = match ($command) {
    'seed' => $seed(6, 'pre'),
    'seed-extra' => $seed(3, 'post'),
    'fingerprint' => $fingerprint(),
    'damage' => (function () use ($argument): array {
        DB::statement('TRUNCATE TABLE "'.$argument.'" CASCADE');

        return ['truncated' => $argument, 'rows_after' => (int) DB::table($argument)->count()];
    })(),
    'drift' => (function () use ($argument): array {
        DB::statement('DROP TABLE IF EXISTS "'.$argument.'" CASCADE');

        return ['dropped' => $argument, 'still_exists' => DB::getSchemaBuilder()->hasTable($argument)];
    })(),
    'unledger' => (function () use ($argument): array {
        $rows = DB::table('migrations')->orderByDesc('batch')->orderByDesc('migration')
            ->limit(max(1, (int) $argument))->pluck('migration')->all();
        foreach ($rows as $migration) {
            DB::table('migrations')->where('migration', $migration)->delete();
        }

        return ['removed' => $rows];
    })(),
    default => ['error' => 'unknown subcommand'],
};

if (isset($output['error'])) {
    fwrite(STDERR, $output['error']."\n");
    exit(64);
}

fwrite(STDOUT, json_encode($output, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n");
