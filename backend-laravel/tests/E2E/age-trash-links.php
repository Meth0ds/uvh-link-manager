<?php

declare(strict_types=1);

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$database = (string) config('database.connections.'.config('database.default').'.database');
if (! app()->environment('testing') || ! str_ends_with($database, '_test')) {
    fwrite(STDERR, "Refusing to mutate trash outside APP_ENV=testing and a _test database.\n");
    exit(64);
}

$workspaceId = filter_var($argv[1] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
$aliasPrefix = trim((string) ($argv[2] ?? ''));
$expectedCount = filter_var($argv[3] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 100]]);
if (! is_int($workspaceId) || ! preg_match('/^[a-z0-9][a-z0-9-]{2,40}$/D', $aliasPrefix) || ! is_int($expectedCount)) {
    fwrite(STDERR, "Usage: php tests/E2E/age-trash-links.php <workspace-id> <safe-alias-prefix> <expected-count>\n");
    exit(64);
}

try {
    $updated = DB::transaction(function () use ($workspaceId, $aliasPrefix, $expectedCount): int {
        // The exact-count check makes a bad test selector fail closed before it
        // can age unrelated data, even inside the already-isolated database.
        $ids = DB::table('links')
            ->where('workspace_id', $workspaceId)
            ->whereNotNull('deleted_at')
            ->where('alias', 'like', $aliasPrefix.'%')
            ->lockForUpdate()
            ->pluck('id');
        if ($ids->count() !== $expectedCount) {
            throw new DomainException("Expected {$expectedCount} scoped links; found {$ids->count()}.");
        }

        return DB::table('links')->whereIn('id', $ids)->update([
            'deleted_at' => now()->subDays(31),
            'updated_at' => now(),
        ]);
    }, 3);
} catch (DomainException $error) {
    fwrite(STDERR, $error->getMessage()."\n");
    exit(1);
}

if ($updated !== $expectedCount) {
    fwrite(STDERR, "Expected to age {$expectedCount} links; updated {$updated}.\n");
    exit(1);
}

// Force this isolated invocation through the heavy-retention stage regardless
// of what an earlier E2E case did with the database-backed checkpoint.
Cache::forget('uvh:housekeeping:last_heavy');
fwrite(STDOUT, "aged {$updated}\n");
