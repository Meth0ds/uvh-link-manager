<?php

/** Test-only concurrent HTTP probe; never emits cookies, URLs or credentials. */
use Illuminate\Contracts\Console\Kernel as ConsoleKernel;
use Illuminate\Contracts\Http\Kernel as HttpKernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(ConsoleKernel::class)->bootstrap();
if (! app()->environment('testing') || ! str_ends_with(DB::connection()->getDatabaseName(), '_test')) {
    exit(64);
}
$options = getopt('', ['cookie:', 'workspace:', 'source:', 'key:', 'alias:', 'barrier:', 'slot:']);
$barrier = (string) ($options['barrier'] ?? '');
$slot = (string) ($options['slot'] ?? '');
if (! in_array($slot, ['0', '1'], true) || ! str_starts_with($barrier, sys_get_temp_dir().'/uvh-duplicate-') || ! is_dir($barrier)) {
    exit(65);
}
config(['workflows.enabled' => true]);
Queue::fake();
file_put_contents($barrier.'/ready-'.$slot, 'ready');
$deadline = microtime(true) + 10;
while (! is_file($barrier.'/go')) {
    if (microtime(true) >= $deadline) {
        exit(66);
    }
    usleep(1000);
}
$csrf = 'duplicate-probe-csrf';
$request = Request::create('http://'.config('uvh.app_host').'/api/v1/links/'.(int) $options['source'].'/duplicate', 'POST', [
    'sourceVersion' => 1, 'alias' => (string) $options['alias'],
], [(string) config('uvh.session_cookie') => (string) $options['cookie'], (string) config('uvh.csrf_cookie') => $csrf], [], [
    'REMOTE_ADDR' => '127.0.0.1', 'HTTP_ACCEPT' => 'application/json', 'HTTP_X_CSRF_TOKEN' => $csrf,
    'HTTP_X_WORKSPACE_ID' => (string) $options['workspace'], 'HTTP_IDEMPOTENCY_KEY' => (string) $options['key'],
]);
$response = $app->make(HttpKernel::class)->handle($request);
$body = json_decode($response->getContent(), true);
echo json_encode(['status' => $response->getStatusCode(), 'id' => $body['link']['id'] ?? null], JSON_THROW_ON_ERROR).PHP_EOL;
