<?php

/** Owned subprocess probe for MailOutboxDispatcherTest; never sends mail. */

use App\Jobs\DeliverMailOutboxJob;
use App\Support\MailOutboxDispatcher;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if (! app()->environment('testing') || ! str_ends_with(DB::connection()->getDatabaseName(), '_test')) {
    fwrite(STDERR, "Refusing mail claim probe outside testing/_test\n");
    exit(64);
}
$options = getopt('', ['id:', 'name:', 'clock:', 'barrier:', 'fail-claim']);
$id = filter_var($options['id'] ?? null, FILTER_VALIDATE_INT);
$name = (string) ($options['name'] ?? '');
if (! $id || $id < 1 || ! preg_match('/^uvh-mail-claim-[a-f0-9]+-[12]$/', $name)) {
    throw new RuntimeException('Invalid owned claim probe arguments');
}
Carbon::setTestNow(Carbon::parse((string) ($options['clock'] ?? '')));
Queue::fake();
DB::select("select set_config('application_name', ?, false)", [$name]);
DB::statement("SET lock_timeout = '10s'");
$directory = isset($options['barrier']) ? realpath((string) $options['barrier']) : false;
if (isset($options['barrier'])) {
    $base = realpath(storage_path('framework/testing'));
    if (! $directory || ! $base || ! str_starts_with($directory, $base.DIRECTORY_SEPARATOR.'mail-claim-')) {
        throw new RuntimeException('Barrier must belong to the owned testing directory');
    }
    DB::listen(static function (QueryExecuted $event) use ($directory, $options): void {
        if (! str_starts_with($event->sql, 'select ') || ! str_contains($event->sql, '"mail_outbox"')) {
            return;
        }
        // The query finished and owns the row lock. Hold it until the parent
        // proves the second process is waiting for a PostgreSQL lock.
        file_put_contents($directory.'/ready', 'locked');
        $deadline = microtime(true) + 15;
        while (! is_file($directory.'/release')) {
            if (microtime(true) >= $deadline) {
                throw new RuntimeException('Owned claim barrier deadline exceeded');
            }
            usleep(10000);
        }
        if (array_key_exists('fail-claim', $options)) {
            throw new RuntimeException('Fixture: claim fails while owning its row lock');
        }
    });
}
$accepted = MailOutboxDispatcher::enqueue($id);
echo json_encode(['accepted' => $accepted, 'jobs' => Queue::pushed(DeliverMailOutboxJob::class)->count()], JSON_THROW_ON_ERROR).PHP_EOL;
