<?php

/**
 * Concurrency probe for `RedirectConcurrencyTest`.
 *
 * Boots the application in a separate OS process and asks `RedirectService`
 * for a verdict at a synchronized instant, then reports when it was inside the
 * resolution. It is deliberately not a PHPUnit test: PHPUnit owns the barrier
 * and the assertions, and a helper that only *looked* concurrent would certify
 * a claim it never proved.
 *
 * Usage:
 *   php tests/Support/redirect-probe.php --alias=NAME --host=HOST --at=EPOCH_SECONDS [--ip=ADDR]
 *
 * Emits a single JSON object on stdout.
 */

use App\Support\RedirectService;
use Illuminate\Contracts\Console\Kernel;

require __DIR__.'/../../vendor/autoload.php';

$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$options = getopt('', ['alias:', 'host:', 'at:', 'ip:', 'warm:']);
$alias = (string) ($options['alias'] ?? '');
$host = (string) ($options['host'] ?? '');
$ip = (string) ($options['ip'] ?? '127.0.0.1');

// Optional: resolve a throwaway alias first so the classes this path touches
// are already loaded. Without it a measurement window also pays for first-use
// class compilation, which hides the effect being measured.
$warm = (string) ($options['warm'] ?? '');
if ($warm !== '') {
    RedirectService::resolve([
        'host' => $host,
        'alias' => $warm,
        'user_agent' => 'uvh-concurrency-probe',
        'accept_language' => 'es',
        'ip' => $ip,
    ]);
}

// Busy-wait on a shared wall-clock instant so every worker enters the
// resolution window within microseconds of the others. Without this the
// workers would drift by process startup cost and never overlap.
$startAt = (float) ($options['at'] ?? 0.0);
while (microtime(true) < $startAt) {
    usleep(100);
}

$start = microtime(true);
$kind = null;
$reason = null;
$error = null;

try {
    $outcome = RedirectService::resolve([
        'host' => $host,
        'alias' => $alias,
        'user_agent' => 'uvh-concurrency-probe',
        'accept_language' => 'es',
        'ip' => $ip,
    ]);
    $kind = isset($outcome['kind']) ? (string) $outcome['kind'] : null;
    $reason = isset($outcome['reason']) ? (string) $outcome['reason'] : null;
} catch (Throwable $exception) {
    $error = $exception::class.': '.$exception->getMessage();
}

echo json_encode([
    'start' => $start,
    'end' => microtime(true),
    'kind' => $kind,
    'reason' => $reason,
    'error' => $error,
]).PHP_EOL;
