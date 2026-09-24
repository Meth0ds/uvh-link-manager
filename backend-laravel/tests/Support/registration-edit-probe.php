<?php

/**
 * Concurrency probe for `RegistrationEditConcurrencyTest`.
 *
 * Boots the application in a separate OS process and issues ONE real
 * `change-registration-email` request through the HTTP kernel at a
 * synchronized instant, then reports its verdict and when it was inside the
 * correction window. It is deliberately not a PHPUnit test: PHPUnit owns the
 * barrier and the assertions, and a helper that only *looked* concurrent would
 * certify a claim it never proved.
 *
 * Usage:
 *   php tests/Support/registration-edit-probe.php --host=HOST --email=CURRENT \
 *        --new=NEW --cookie=SECRET --at=EPOCH_SECONDS
 *
 * Emits a single JSON object on stdout.
 */

use Illuminate\Contracts\Console\Kernel as ConsoleKernel;
use Illuminate\Contracts\Http\Kernel as HttpKernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

require __DIR__.'/../../vendor/autoload.php';

$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(ConsoleKernel::class)->bootstrap();

$options = getopt('', ['host:', 'email:', 'new:', 'cookie:', 'at:']);
$host = (string) ($options['host'] ?? '');
$email = (string) ($options['email'] ?? '');
$newEmail = (string) ($options['new'] ?? '');
$cookie = (string) ($options['cookie'] ?? '');
$startAt = (float) ($options['at'] ?? 0.0);

$database = (string) config('database.connections.'.config('database.default').'.database');
if (! app()->environment('testing') || ! str_ends_with($database, '_test')) {
    fwrite(STDERR, "Refusing to run the edit probe outside APP_ENV=testing and a _test database.\n");
    exit(64);
}

// The captcha is answered over HTTP in every environment; here it is faked
// exactly like `Tests\TestCase` fakes it. The captcha is not what this probe
// is about.
Http::fake(fn () => Http::response([
    'success' => true,
    'hostname' => (string) config('uvh.app_host'),
]));

$csrf = 'registration-edit-probe-csrf';
$build = static function (string $secret) use ($host, $email, $newEmail, $csrf): Request {
    return Request::create(
        'http://'.$host.'/api/v1/auth/change-registration-email',
        'POST',
        [
            'currentEmail' => $email,
            'newEmail' => $newEmail,
            'captchaToken' => 'test-registration-passcode',
            'website' => '',
        ],
        ['uvh_csrf' => $csrf, 'uvh_registration_edit' => $secret],
        [],
        [
            'REMOTE_ADDR' => '127.0.0.1',
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_X-CSRF_TOKEN' => $csrf,
        ],
    );
};

// Warm-up with a worthless secret so first-use class loading is paid before
// the measured window and cannot hide the interleaving being observed.
$app->make(HttpKernel::class)->handle($build('warmup-not-a-secret'));

// Busy-wait on a shared wall-clock instant so every worker enters the request
// within microseconds of the others. Without this the workers would drift by
// process startup cost and never overlap.
while (microtime(true) < $startAt) {
    usleep(100);
}

$start = microtime(true);
$kind = null;
$error = null;
try {
    $response = $app->make(HttpKernel::class)->handle($build($cookie));
    $status = $response->getStatusCode();
    $kind = match (true) {
        $status === 200 => 'ok',
        $status === 403 => 'refused',
        default => 'unexpected',
    };
    if ($kind === 'unexpected') {
        $error = 'HTTP '.$status.': '.$response->getContent();
    }
} catch (Throwable $exception) {
    $error = $exception::class.': '.$exception->getMessage();
}

echo json_encode([
    'start' => $start,
    'end' => microtime(true),
    'kind' => $kind,
    'error' => $error,
]).PHP_EOL;
