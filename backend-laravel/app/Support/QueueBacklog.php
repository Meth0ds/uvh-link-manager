<?php

namespace App\Support;

use Illuminate\Queue\RedisQueue;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Redis;

/**
 * Queue depth and age for whichever broker the deployment runs.
 *
 * Monitoring used to read the `jobs` table directly, which only the database
 * driver populates. That made the gauges right by accident: with Redis as the
 * broker the table stays empty forever, so every queue would have reported zero
 * backlog while work piled up — a silent blind spot, not a visible failure.
 * These helpers ask the configured driver instead and report "unreadable"
 * rather than a healthy-looking zero when they cannot answer.
 */
final class QueueBacklog
{
    /**
     * Physical queue name per monitored pool, in gauge-name order.
     *
     * @return array<string, string>
     */
    public static function pools(): array
    {
        return [
            'mail' => 'mail',
            'webhooks' => 'webhooks',
            'domains' => 'domains',
            'exports' => 'exports',
            'analytics' => 'analytics',
            // Destination reputation talks to a third party with its own
            // timeout, so it gets its own pool: a slow provider must not
            // delay mail, webhooks or anything else.
            'security' => 'security',
            // The legacy worker drains the default queue. The gauge label is
            // part of the published metric surface and must not be renamed.
            'legacy' => 'default',
        ];
    }

    /**
     * Pending jobs for one queue, using the driver's own definition.
     *
     * Returns null when the broker cannot be asked; callers must not present
     * that as an empty queue.
     */
    public static function pending(string $queue): ?int
    {
        try {
            return max(0, (int) Queue::connection()->size($queue));
        } catch (\Throwable) {
            OperationalMetrics::increment('queue.metrics_unavailable');

            return null;
        }
    }

    /**
     * Age in seconds of the oldest job that has not been completed yet.
     *
     * Returns null when it cannot be determined. Zero means "nothing pending",
     * which is the only case where a zero is the truth.
     */
    public static function oldestAgeSeconds(string $queue): ?int
    {
        try {
            $connection = Queue::connection();

            if ($connection instanceof RedisQueue) {
                $createdAt = self::redisOldestCreatedAt($connection, $queue);

                if ($createdAt !== null) {
                    return max(0, time() - $createdAt);
                }

                // No readable payload. An empty queue legitimately has age
                // zero; anything else is an unreadable state, not a healthy one.
                return (int) $connection->size($queue) === 0 ? 0 : null;
            }

            $table = (string) config('queue.connections.'.(string) config('queue.default').'.table', 'jobs');
            $oldest = DB::table($table)->where('queue', $queue)->min('created_at');

            return $oldest === null ? 0 : max(0, time() - (int) $oldest);
        } catch (\Throwable) {
            OperationalMetrics::increment('queue.metrics_unavailable');

            return null;
        }
    }

    /**
     * Enqueue time of the oldest job Redis is holding for this queue.
     *
     * Ready work is the head of the list. Jobs waiting for a retry backoff or
     * already reserved by a worker live in companion structures, and every one
     * of them carries its enqueue timestamp inside the payload. Reading the
     * payload therefore avoids interpreting Redis scores, whose shape differs
     * between clients, and keeps one definition for all three states.
     */
    private static function redisOldestCreatedAt(RedisQueue $connection, string $queue): ?int
    {
        $client = Redis::connection(self::redisConnectionName());
        $key = $connection->getQueue($queue);

        $raw = $client->lindex($key, 0);
        foreach ([$key.':delayed', $key.':reserved'] as $candidate) {
            if (is_string($raw) && $raw !== '') {
                break;
            }
            $members = $client->zrange($candidate, 0, 0);
            $raw = is_array($members) ? ($members[0] ?? '') : '';
        }

        return self::enqueuedAt($raw);
    }

    /** Redis connection the queue driver was configured with. */
    private static function redisConnectionName(): string
    {
        $name = (string) config('queue.connections.'.(string) config('queue.default').'.connection', 'default');

        return $name === '' ? 'default' : $name;
    }

    private static function enqueuedAt(mixed $raw): ?int
    {
        if (! is_string($raw) || $raw === '') {
            return null;
        }

        $payload = json_decode($raw, true);
        if (! is_array($payload)) {
            return null;
        }

        // Laravel writes the enqueue time as `createdAt`. The older `pushedAt`
        // spelling is accepted so a framework rename degrades into "unreadable"
        // instead of a healthy-looking zero.
        $createdAt = $payload['createdAt'] ?? $payload['pushedAt'] ?? null;

        return is_int($createdAt) || (is_string($createdAt) && ctype_digit($createdAt))
            ? (int) $createdAt
            : null;
    }
}
