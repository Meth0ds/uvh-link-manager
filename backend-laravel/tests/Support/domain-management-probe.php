<?php

/** One real kernel request in a separate process; isolated *_test databases only. */
use Illuminate\Contracts\Console\Kernel as ConsoleKernel;
use Illuminate\Contracts\Http\Kernel as HttpKernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(ConsoleKernel::class)->bootstrap();
if (! app()->environment('testing') || ! str_ends_with(DB::connection()->getDatabaseName(), '_test')) {
    fwrite(STDERR, "Refusing a concurrency probe outside testing/_test.\n");
    exit(64);
}
$input = json_decode(stream_get_contents(STDIN), true, 32, JSON_THROW_ON_ERROR);
Queue::fake();
DB::select("SELECT set_config('application_name', ?, false)", [$input['name']]);
config(['uvh.app_host' => 'app.uvh.test', 'uvh.public_host' => 'uvh.es']);
$csrf = 'domain-probe-csrf';
$request = Request::create('http://app.uvh.test'.$input['path'], $input['method'], [], [
    (string) config('uvh.session_cookie') => $input['session'], 'uvh_csrf' => $csrf,
], [], [
    'REMOTE_ADDR' => '127.0.0.1', 'CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json',
    'HTTP_X_CSRF_TOKEN' => $csrf, 'HTTP_X_WORKSPACE_ID' => (string) $input['workspace'],
    'HTTP_IDEMPOTENCY_KEY' => $input['key'] ?? 'domain-probe-operation',
], json_encode($input['body'], JSON_THROW_ON_ERROR));
$start = microtime(true);
$kernel = $app->make(HttpKernel::class);
$response = $kernel->handle($request);
echo json_encode(['start' => $start, 'end' => microtime(true), 'status' => $response->getStatusCode()], JSON_THROW_ON_ERROR).PHP_EOL;
$kernel->terminate($request, $response);
