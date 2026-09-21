<?php

declare(strict_types=1);

/**
 * The stack itself: broker depth, process heartbeats, the scheduler's own
 * command, and the one lever that deletes what the broker is holding.
 */

use App\Support\QueueBacklog;
use Illuminate\Queue\RedisQueue;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Redis;
use Symfony\Component\Console\Output\BufferedOutput;

return [
    'broker-flush' => static function (string $argument): array {
        $connection = Queue::connection();
        if (! $connection instanceof RedisQueue) {
            return ['flushed' => 0, 'driver' => 'not-redis'];
        }
        $client = Redis::connection((string) config('queue.connections.'.(string) config('queue.default').'.connection', 'default'));
        $keys = [];
        foreach (array_values(QueueBacklog::pools()) as $queue) {
            $key = $connection->getQueue($queue);
            $keys = [...$keys, $key, $key.':delayed', $key.':reserved'];
        }

        return ['flushed' => (int) $client->del($keys), 'driver' => 'redis'];
    },
    'queue' => static fn (string $argument): array => array_map(
        static fn (string $queue): array => [
            'queue' => $queue,
            'pending' => QueueBacklog::pending($queue) ?? -1,
        ],
        array_values(QueueBacklog::pools()),
    ),
    // -----------------------------------------------------------------------
    // Crash and recovery drills
    //
    // Everything below either reads durable state or advances a *schedule* — a
    // retry backoff, the staleness window of an abandoned request, the retention
    // age of a terminal row — exactly like the `*-warp` subcommands above. No
    // subcommand changes a product decision: the worker, the reconciler, the
    // compensation and the purge still run in the application's own code.
    // -----------------------------------------------------------------------

    'heartbeat' => static function (string $argument): array {
        $value = Cache::get('uvh:health:'.$argument);

        return [
            'component' => $argument,
            'present' => $value !== null,
            'age_seconds' => is_numeric($value) ? max(0, time() - (int) $value) : null,
        ];
    },
    // The scheduler's own scheduled command, run as the scheduler runs it. The
    // buffer keeps its console output out of this script's stdout, which the
    // harness parses as JSON.

    'housekeeping' => static function (string $argument): array {
        $buffer = new BufferedOutput;
        $exit = Artisan::call('uvh:housekeeping', [], $buffer);

        return ['exit' => $exit, 'bytes' => strlen($buffer->fetch())];
    },
    // Fills one account with enough privacy-rights content that its automated
    // export lands just under the 12 MiB cap, so the crash drills exercise the
    // maximum-size path instead of a toy payload.
    //
    // The row count is *fitted*, not guessed. The cap applies to the encoded
    // JSON, and the encoding is not the sum of the message bodies: 9,000
    // messages of 1,300 bytes — the count this drill asked for at first —
    // encode to 13.1 MiB, so the worker refused its own maximum-size export and
    // the drill measured the refusal instead of the crash recovery. The payload
    // is therefore built here with the job's own builder and the count is
    // reduced until the document fits under the cap with a margin for the audit
    // events the request itself will write.

    'heavy-due' => static fn (string $argument): array => ['opened' => Cache::forget('uvh:housekeeping:last_heavy')],
];
