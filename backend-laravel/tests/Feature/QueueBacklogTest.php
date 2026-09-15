<?php

namespace Tests\Feature;

use App\Support\QueueBacklog;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Queue depth and age used to be read straight from the `jobs` table, which
 * only the database driver writes. With Redis as the broker that table stays
 * empty forever, so every monitoring gauge would have reported an idle system
 * while work piled up. These tests pin the two properties that keep that blind
 * spot from coming back: the reading follows the configured broker, and a
 * broker that cannot be read is reported as unknown instead of as zero.
 */
final class QueueBacklogTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE jobs RESTART IDENTITY');
        DB::statement('TRUNCATE operational_metrics');
    }

    public function test_pool_labels_keep_the_published_gauge_names(): void
    {
        // The label is part of the Prometheus surface: renaming it silently
        // breaks alerts that are keyed on it.
        $this->assertSame(
            ['mail', 'webhooks', 'domains', 'exports', 'analytics', 'security', 'legacy'],
            array_keys(QueueBacklog::pools()),
        );
        // The legacy worker drains Laravel's default queue.
        $this->assertSame('default', QueueBacklog::pools()['legacy']);
    }

    public function test_depth_and_age_are_read_from_the_configured_broker(): void
    {
        // The suite pins the sync driver so dispatched jobs run inline. This
        // test is about reading a persistent broker, so it restores the
        // database driver the same way a deployment configures one.
        config(['queue.default' => 'database']);
        $this->insertJob('mail', 300);
        $this->insertJob('mail', 60);

        $this->assertSame(2, QueueBacklog::pending('mail'));
        $this->assertSame(0, QueueBacklog::pending('exports'));
        $this->assertEqualsWithDelta(300, QueueBacklog::oldestAgeSeconds('mail'), 5);
        // An empty queue legitimately has age zero: that is the only case where
        // zero is the truth rather than a missing measurement.
        $this->assertSame(0, QueueBacklog::oldestAgeSeconds('exports'));
    }

    public function test_an_unreadable_broker_is_unknown_and_counted(): void
    {
        config(['queue.default' => 'not-a-configured-connection']);

        $this->assertNull(QueueBacklog::pending('mail'));
        $this->assertNull(QueueBacklog::oldestAgeSeconds('mail'));

        // The gap has to be observable. A monitoring read that failed and
        // reported zero would be indistinguishable from an idle queue.
        $this->assertSame(
            2,
            (int) DB::table('operational_metrics')->where('metric', 'queue.metrics_unavailable')->sum('count'),
        );
    }

    public function test_the_global_oldest_age_follows_the_oldest_pool(): void
    {
        // A stalled pool is exactly what this gauge exists to reveal, so the
        // global series has to follow the oldest pool. Aggregating the newest
        // one instead would report the 10s queue and hide a 300s backlog, which
        // is how a blocked class of work goes unnoticed. Depth keeps the
        // opposite aggregate: the sum is the real amount of pending work.
        config(['queue.default' => 'database']);
        $this->insertJob('mail', 10);
        $this->insertJob('exports', 300);
        $this->insertJob('analytics', 30);

        $token = str_repeat('a', 48);
        config(['uvh.metrics.bearer_token' => $token]);

        $response = $this->withHeader('Authorization', 'Bearer '.$token)->get('/internal/metrics');
        $response->assertOk();
        $body = (string) $response->getContent();

        $this->assertSame(3, $this->gauge($body, 'uvh_queue_pending_jobs'));
        $this->assertEqualsWithDelta(300, $this->gauge($body, 'uvh_queue_oldest_job_age_seconds'), 5);

        // The per-pool gauges stay untouched: the global series must not
        // flatten them into one number.
        $this->assertEqualsWithDelta(10, $this->gauge($body, 'uvh_queue_mail_oldest_job_age_seconds'), 5);
        $this->assertEqualsWithDelta(300, $this->gauge($body, 'uvh_queue_exports_oldest_job_age_seconds'), 5);
        $this->assertEqualsWithDelta(30, $this->gauge($body, 'uvh_queue_analytics_oldest_job_age_seconds'), 5);
    }

    private function gauge(string $body, string $name): int
    {
        $this->assertMatchesRegularExpression('/^'.preg_quote($name, '/').' (\d+)$/m', $body);

        preg_match('/^'.preg_quote($name, '/').' (\d+)$/m', $body, $matches);

        return (int) $matches[1];
    }

    private function insertJob(string $queue, int $ageSeconds): void
    {
        DB::table('jobs')->insert([
            'queue' => $queue,
            'payload' => json_encode([
                'uuid' => uniqid('fixture-', true),
                'displayName' => 'QueueBacklogFixture',
                'job' => 'Illuminate\Queue\CallQueuedHandler@call',
                'data' => [],
            ], JSON_THROW_ON_ERROR),
            'attempts' => 0,
            'reserved_at' => null,
            'available_at' => time() - $ageSeconds,
            'created_at' => time() - $ageSeconds,
        ]);
    }
}
