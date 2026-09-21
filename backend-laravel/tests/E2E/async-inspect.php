<?php

declare(strict_types=1);

/**
 * State reader and lever surface for the asynchronous E2E driver.
 *
 * The browser suite asserts what a user sees. This harness has to assert what a
 * worker eventually wrote, so it needs a narrow, read-mostly window into the
 * durable tables. Every subcommand prints exactly one JSON document on stdout
 * and exits 64 on an unknown name or on one its own validation refused.
 *
 * The subcommands themselves live in `inspect/`, one file per entity, each
 * returning a map of name -> handler. They are registered here and nowhere
 * else, so this file is both the entry point and the list of what the harness
 * can ask for.
 *
 * `*-warp` subcommands advance a *retry schedule* to now. They do not change
 * any product decision: the worker, the backoff policy and the scheduler tick
 * are untouched. Waiting 60 real seconds for a first retry would otherwise make
 * the suite unusable, and the repository already establishes this pattern
 * (age-mfa-session.php, age-trash-links.php).
 */

use Illuminate\Contracts\Console\Kernel;

require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$database = (string) config('database.connections.'.config('database.default').'.database');
if (! app()->environment('testing') || ! str_ends_with($database, '_test')) {
    fwrite(STDERR, "Refusing to inspect state outside APP_ENV=testing and a _test database.\n");
    exit(64);
}

$command = (string) ($argv[1] ?? '');
$argument = (string) ($argv[2] ?? '');

$subcommands = array_merge(
    require __DIR__.'/inspect/infrastructure.php',
    require __DIR__.'/inspect/mail.php',
    require __DIR__.'/inspect/webhooks.php',
    require __DIR__.'/inspect/analytics.php',
    require __DIR__.'/inspect/exports.php',
    require __DIR__.'/inspect/domains.php',
    require __DIR__.'/inspect/accounts.php',
);

$handler = $subcommands[$command] ?? null;
$output = $handler === null ? ['error' => 'unknown subcommand'] : $handler($argument);

if (isset($output['error'])) {
    fwrite(STDERR, $output['error']."\n");
    exit(64);
}

fwrite(STDOUT, json_encode($output, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n");
