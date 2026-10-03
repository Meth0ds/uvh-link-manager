<?php

/** Test-only two-process email reservation probe. Emits sanitized verdicts. */
use Illuminate\Contracts\Console\Kernel as ConsoleKernel;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Contracts\Http\Kernel as HttpKernel;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(ConsoleKernel::class)->bootstrap();
if (! app()->environment('testing') || DB::connection()->getDatabaseName() !== 'uvh_test') {
    fwrite(STDERR, "Refusing probe outside testing/uvh_test.\n");
    exit(64);
}
$options = getopt('', ['cookie:', 'target:', 'barrier:', 'slot:']);
$barrier = (string) ($options['barrier'] ?? '');
$slot = (string) ($options['slot'] ?? '');
if (! in_array($slot, ['0', '1'], true)
    || ! str_starts_with($barrier, sys_get_temp_dir().'/uvh-email-change-')
    || ! is_dir($barrier)) {
    exit(65);
}
Queue::fake();
DB::select("SELECT set_config('application_name', ?, false)", ['uvh-email-change-probe-'.$slot]);
$states = [];
$app->make(ExceptionHandler::class)->reportable(static function (QueryException $error) use (&$states): bool {
    $states[] = (string) ($error->errorInfo[0] ?? 'unknown');

    return false;
});
$wait = static function (string $file): void {
    $deadline = microtime(true) + 12;
    while (! is_file($file)) {
        if (microtime(true) >= $deadline) {
            throw new RuntimeException('Fixture barrier timeout');
        }
        usleep(10_000);
    }
};
$authorized = false;
$deleted = false;
DB::listen(static function (QueryExecuted $query) use ($barrier, $slot, $wait, &$authorized, &$deleted): void {
    if (! $authorized && DB::transactionLevel() > 0
        && str_starts_with($query->sql, 'update "sessions"')
        && str_contains($query->sql, '"mfa_verified_at"')) {
        $authorized = true;
        file_put_contents($barrier.'/authorized-'.$slot, (string) microtime(true));
        $wait($barrier.'/authorize');
    }
    if (! $deleted && str_starts_with($query->sql, 'delete from "email_change_requests"')
        && ! str_contains($query->sql, '"expires_at"')) {
        $deleted = true;
        file_put_contents($barrier.'/deleted-'.$slot, (string) microtime(true));
        $wait($barrier.'/insert');
    }
});
$csrf = 'email-probe-csrf';
$start = microtime(true);
$errorClass = null;
$status = null;
try {
    $request = Request::create('http://'.config('uvh.app_host').'/api/v1/auth/change-email', 'POST', [
        'newEmail' => (string) ($options['target'] ?? ''), 'password' => 'tiovivo-cobrizo-astilla-42',
        'factorCode' => 'ABCD2345EFGH6789',
    ], ['uvh_session' => (string) ($options['cookie'] ?? ''), 'uvh_csrf' => $csrf], [], [
        'REMOTE_ADDR' => '127.0.0.1', 'HTTP_ACCEPT' => 'application/json', 'HTTP_X_CSRF_TOKEN' => $csrf,
    ]);
    $status = $app->make(HttpKernel::class)->handle($request)->getStatusCode();
} catch (Throwable $error) {
    $errorClass = $error::class;
}
echo json_encode(['status' => $status, 'states' => $states, 'authorized' => $authorized, 'deleted' => $deleted,
    'start' => $start, 'end' => microtime(true), 'errorClass' => $errorClass], JSON_THROW_ON_ERROR).PHP_EOL;
