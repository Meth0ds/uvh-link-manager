<?php

namespace Tests\Unit;

use App\Support\QueueBacklog;
use PHPUnit\Framework\TestCase;
use Tests\Support\RepositoryRoot;

/**
 * The three budgets a queued job lives inside, held together.
 *
 * A worker kills whatever overruns its `--timeout`. The job's own `$timeout` has
 * to fire first, so it can finish its own failure path — release the lease, mark
 * the delivery failed, report the attempt — instead of being killed mid-write.
 * Both have to stay under the broker's `retry_after`, or the job becomes runnable
 * again while the previous attempt is still working, which is how one export runs
 * twice or two workers publish the same artifact.
 *
 * Nothing tied the three together, and one pool was already outside the rule: the
 * security worker declared `--timeout=60` while its longest job declared 60 s
 * too, so the two alarms raced instead of nesting and the deployment's own claim
 * about the hierarchy was false for that pool. This reads the three sources — the
 * compose topology, the job classes and the shipped environment template —
 * instead of trusting any of them.
 *
 * The shipped template matters on its own: `config/queue.php` defaults the Redis
 * window to Laravel's 90 s, which is below the exports worker's 180 s, so a
 * deployment that lost the key would hand the same job to a second worker. Both
 * files that a deployer copies therefore have to pin a window above every worker.
 */
class QueueTimeoutContractTest extends TestCase
{
    private const COMPOSE = 'docker-compose.production.yml';

    private const ENV_TEMPLATE = 'backend-laravel/.env.production.example';

    private const JOBS = 'backend-laravel/app/Jobs';

    /**
     * Every worker service, keyed by its compose service name.
     *
     * @return array<string, array{pool: string, queue: string, timeout: int}>
     */
    private function workers(): array
    {
        $compose = RepositoryRoot::read(self::COMPOSE);

        preg_match_all('/^  queue-([a-z0-9-]+):\n(.*?)(?=\n  \S|\z)/ms', $compose, $services, PREG_SET_ORDER);
        $this->assertNotSame([], $services, 'docker-compose.production.yml declares no queue-* service at all');

        $workers = [];
        foreach ($services as [, $service, $body]) {
            preg_match('/UVH_QUEUE_POOL:\s*([a-z0-9-]+)/', $body, $pool);
            preg_match('/--queue=([a-z0-9-]+)/', $body, $queue);
            preg_match('/--timeout=(\d+)/', $body, $timeout);

            $this->assertNotSame('', $pool[1] ?? '', "queue-{$service} does not declare UVH_QUEUE_POOL, so its heartbeat and its metrics are unattributed");
            $this->assertNotSame('', $queue[1] ?? '', "queue-{$service} does not declare the queue it drains");
            $this->assertNotSame('', $timeout[1] ?? '', "queue-{$service} does not declare a worker timeout");

            $workers['queue-'.$service] = [
                'pool' => $pool[1],
                'queue' => $queue[1],
                'timeout' => (int) $timeout[1],
            ];
        }

        return $workers;
    }

    /** @return list<array{job: string, queue: string, timeout: int}> */
    private function jobs(): array
    {
        $jobs = [];
        foreach (glob(RepositoryRoot::path().'/'.self::JOBS.'/*.php') ?: [] as $path) {
            $source = (string) file_get_contents($path);
            if (preg_match("/onQueue\('([a-z0-9-]+)'\)/", $source, $queue) !== 1) {
                continue;
            }
            if (preg_match('/\$timeout\s*=\s*(\d+)/', $source, $timeout) !== 1) {
                continue;
            }
            $jobs[] = [
                'job' => basename($path, '.php'),
                'queue' => $queue[1],
                'timeout' => (int) $timeout[1],
            ];
        }

        // A glob that silently matched nothing would turn every assertion below
        // into a vacuous pass, which is the failure mode this contract exists to
        // prevent.
        $this->assertGreaterThanOrEqual(8, count($jobs), 'the job classes could not be read, so this contract checked nothing');

        return $jobs;
    }

    /** The retry window each deployment file promises for the Redis queue driver. */
    private function retryWindows(): array
    {
        $windows = [];

        preg_match('/REDIS_QUEUE_RETRY_AFTER:\s*"?(\d+)"?/', RepositoryRoot::read(self::COMPOSE), $compose);
        $this->assertNotSame('', $compose[1] ?? '', 'the production compose no longer pins REDIS_QUEUE_RETRY_AFTER');
        $windows[self::COMPOSE] = (int) $compose[1];

        preg_match('/^REDIS_QUEUE_RETRY_AFTER=(\d+)$/m', RepositoryRoot::read(self::ENV_TEMPLATE), $template);
        $this->assertNotSame('', $template[1] ?? '', 'the shipped environment template no longer pins REDIS_QUEUE_RETRY_AFTER, so a deployment would inherit Laravel\'s 90 s default');
        $windows[self::ENV_TEMPLATE] = (int) $template[1];

        return $windows;
    }

    public function test_every_job_finishes_before_its_worker_and_its_worker_before_the_retry_window(): void
    {
        $workers = $this->workers();

        $byQueue = [];
        foreach ($workers as $service => $worker) {
            $previous = $byQueue[$worker['queue']] ?? null;
            $this->assertNull(
                $previous,
                "{$service} and ".($previous ?? '').' drain the same queue: the pool split would be nominal',
            );
            $byQueue[$worker['queue']] = $service;
        }

        $checked = 0;
        foreach ($this->jobs() as $job) {
            $service = $byQueue[$job['queue']] ?? null;
            if ($service === null) {
                // The legacy pool drains Laravel's default queue and no job in the
                // tree targets it: pre-deployment payloads only.
                continue;
            }

            $this->assertLessThan(
                $workers[$service]['timeout'],
                $job['timeout'],
                "{$job['job']} allows {$job['timeout']}s inside {$service}, whose worker is killed at {$workers[$service]['timeout']}s: the job would die mid-write instead of reporting its own failure",
            );
            $checked++;
        }

        $this->assertGreaterThanOrEqual(8, $checked, 'no job was actually compared against its worker');

        foreach ($this->retryWindows() as $file => $window) {
            foreach ($workers as $service => $worker) {
                $this->assertLessThan(
                    $window,
                    $worker['timeout'],
                    "{$service} runs for {$worker['timeout']}s inside the {$window}s retry window {$file} declares: the broker would hand the same job to a second worker while the first is still working",
                );
            }
        }
    }

    public function test_every_pool_the_application_reports_has_a_worker_draining_the_queue_it_names(): void
    {
        $workers = $this->workers();

        foreach (QueueBacklog::pools() as $pool => $queue) {
            $this->assertArrayHasKey(
                'queue-'.$pool,
                $workers,
                "QueueBacklog reports the '{$pool}' pool but no queue-{$pool} service supervises it, so its depth is measured and its starvation is not",
            );
            $this->assertSame($pool, $workers['queue-'.$pool]['pool'], "queue-{$pool} attributes its heartbeat to another pool");
            $this->assertSame(
                $queue,
                $workers['queue-'.$pool]['queue'],
                "queue-{$pool} drains '{$workers['queue-'.$pool]['queue']}' while the application reports '{$queue}' for that pool: the metric would describe a queue nobody supervises",
            );
        }

        // The reverse direction: a worker nobody measures is a pool whose
        // starvation is invisible.
        foreach ($workers as $service => $worker) {
            $this->assertContains(
                $worker['pool'],
                array_keys(QueueBacklog::pools()),
                "{$service} reports pool '{$worker['pool']}', which the application does not publish",
            );
        }
    }
}
