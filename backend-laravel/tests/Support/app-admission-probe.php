<?php

use App\Support\RedirectService;
use Illuminate\Contracts\Console\Kernel;

// CLI-only concurrency worker. Input/output contain no grant or password.
require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if (! app()->environment('testing')) {
    throw new RuntimeException('Testing only');
}
config(['app_links.native' => true]);
$input = json_decode(stream_get_contents(STDIN), true, 16, JSON_THROW_ON_ERROR);
while (microtime(true) < $input['at']) {
    usleep(1000);
}
$start = microtime(true);
try {
    $r = RedirectService::resolve(['host' => $input['host'], 'alias' => $input['alias'], 'native_profile' => $input['profile'], 'native_protocol' => true, 'app_attempt_id' => $input['attempt'], 'user_agent' => 'Native admission probe', 'ip' => '127.0.0.1']);
    echo json_encode(['kind' => $r['kind'], 'error' => null, 'start' => $start, 'end' => microtime(true)], JSON_THROW_ON_ERROR);
} catch (Throwable $e) {
    echo json_encode(['kind' => null, 'error' => $e::class, 'start' => $start, 'end' => microtime(true)], JSON_THROW_ON_ERROR);
    exit(1);
}
