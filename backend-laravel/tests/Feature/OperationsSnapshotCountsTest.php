<?php

namespace Tests\Feature;

use App\Http\Controllers\OperationsController;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class OperationsSnapshotCountsTest extends TestCase
{
    private const MAIL_STATES = ['pending', 'queued', 'processing', 'sent', 'failed', 'obsolete', 'comp_pending', 'compensating', 'compensated'];

    private const WEBHOOK_STATES = ['pending', 'processing', 'success', 'failed'];

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, workspaces, mail_outbox, webhook_deliveries, jobs, failed_jobs, operational_metrics RESTART IDENTITY CASCADE');
        Queue::fake();
        config(['queue.default' => 'database', 'uvh.metrics.bearer_token' => 'o97-test-only']);
    }

    public static function publishedStates(): array
    {
        $cases = [];
        foreach (self::MAIL_STATES as $state) {
            $cases['mail '.$state] = ['mail', $state];
        }
        foreach (self::WEBHOOK_STATES as $state) {
            $cases['webhook '.$state] = ['webhook', $state];
        }

        return $cases;
    }

    #[DataProvider('publishedStates')]
    public function test_every_published_state_is_counted_and_only_unresolved_work_has_age(string $kind, string $state): void
    {
        if ($kind === 'mail') {
            $this->insertMail($state, 300);
        } else {
            $this->insertWebhook($this->hook(), $state, 300);
        }
        [$response, $queries] = $this->sample();
        $body = (string) $response->getContent();
        foreach (self::MAIL_STATES as $status) {
            $this->assertSame($kind === 'mail' && $status === $state ? 1 : 0, $this->gauge($body, 'uvh_mail_outbox_'.$status));
        }
        foreach (self::WEBHOOK_STATES as $status) {
            $this->assertSame($kind === 'webhook' && $status === $state ? 1 : 0, $this->gauge($body, 'uvh_webhook_deliveries_'.$status));
        }
        $mailPending = $kind === 'mail' && in_array($state, ['pending', 'queued', 'processing', 'comp_pending', 'compensating'], true);
        $webhookPending = $kind === 'webhook' && in_array($state, ['pending', 'processing'], true);
        $this->assertEqualsWithDelta($mailPending ? 300 : 0, $this->gauge($body, 'uvh_mail_outbox_oldest_pending_age_seconds'), $mailPending ? 5 : 0);
        $this->assertEqualsWithDelta($webhookPending ? 300 : 0, $this->gauge($body, 'uvh_webhook_oldest_pending_age_seconds'), $webhookPending ? 5 : 0);
        $this->assertOneReadPerTable($queries);
    }

    public function test_empty_tables_keep_every_zero_metric_header_and_published_order(): void
    {
        [$response, $queries] = $this->sample();
        $body = (string) $response->getContent();
        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('text/plain; version=0.0.4; charset=utf-8', $response->headers->get('Content-Type'));
        $this->assertSame('no-store, private', $response->headers->get('Cache-Control'));
        $this->assertSame('nosniff', $response->headers->get('X-Content-Type-Options'));
        $lastPosition = -1;
        foreach ([...array_map(static fn ($state) => 'uvh_mail_outbox_'.$state, self::MAIL_STATES),
            'uvh_mail_outbox_oldest_pending_age_seconds',
            ...array_map(static fn ($state) => 'uvh_webhook_deliveries_'.$state, self::WEBHOOK_STATES),
            'uvh_webhook_oldest_pending_age_seconds'] as $metric) {
            $this->assertSame(0, $this->gauge($body, $metric));
            $position = strpos($body, '# TYPE '.$metric.' gauge');
            $this->assertNotFalse($position);
            $this->assertGreaterThan($lastPosition, $position);
            $lastPosition = $position;
        }
        $this->assertOneReadPerTable($queries);
    }

    public function test_oldest_work_includes_compensation_and_all_tenants_but_ignores_terminal_history(): void
    {
        $first = $this->hook();
        $second = $this->hook();
        $this->insertMail('pending', 20);
        $this->insertMail('compensating', 600);
        $this->insertMail('sent', 9000);
        $this->insertWebhook($first, 'pending', 10);
        $this->insertWebhook($second, 'processing', 900);
        $this->insertWebhook($first, 'success', 12000);
        [$response, $queries] = $this->sample();
        $body = (string) $response->getContent();
        $this->assertSame(1, $this->gauge($body, 'uvh_mail_outbox_sent'));
        $this->assertSame(1, $this->gauge($body, 'uvh_webhook_deliveries_processing'));
        $this->assertEqualsWithDelta(600, $this->gauge($body, 'uvh_mail_outbox_oldest_pending_age_seconds'), 5);
        $this->assertEqualsWithDelta(900, $this->gauge($body, 'uvh_webhook_oldest_pending_age_seconds'), 5);
        $this->assertOneReadPerTable($queries);
    }

    public function test_future_work_has_zero_age_and_each_scrape_reads_fresh_state(): void
    {
        $mail = $this->insertMail('pending', -3600);
        $delivery = $this->insertWebhook($this->hook(), 'pending', -3600);
        [$first, $firstQueries] = $this->sample();
        $this->assertSame(0, $this->gauge((string) $first->getContent(), 'uvh_mail_outbox_oldest_pending_age_seconds'));
        $this->assertSame(0, $this->gauge((string) $first->getContent(), 'uvh_webhook_oldest_pending_age_seconds'));
        DB::table('mail_outbox')->where('id', $mail)->update(['status' => 'sent']);
        DB::table('webhook_deliveries')->where('id', $delivery)->update(['status' => 'success']);
        $this->insertMail('comp_pending', 120);
        [$second, $secondQueries] = $this->sample();
        $body = (string) $second->getContent();
        $this->assertSame(0, $this->gauge($body, 'uvh_mail_outbox_pending'));
        $this->assertSame(1, $this->gauge($body, 'uvh_mail_outbox_sent'));
        $this->assertSame(1, $this->gauge($body, 'uvh_mail_outbox_comp_pending'));
        $this->assertSame(0, $this->gauge($body, 'uvh_webhook_deliveries_pending'));
        $this->assertSame(1, $this->gauge($body, 'uvh_webhook_deliveries_success'));
        $this->assertEqualsWithDelta(120, $this->gauge($body, 'uvh_mail_outbox_oldest_pending_age_seconds'), 5);
        $this->assertOneReadPerTable($firstQueries);
        $this->assertOneReadPerTable($secondQueries);
    }

    public static function deniedCredentials(): array
    {
        return [
            'absent' => ['o97-test-only', null],
            'wrong' => ['o97-test-only', 'wrong'],
            'unconfigured' => ['', 'o97-test-only'],
        ];
    }

    #[DataProvider('deniedCredentials')]
    public function test_bearer_guard_runs_before_any_query(string $configured, ?string $provided): void
    {
        config(['uvh.metrics.bearer_token' => $configured]);
        [$response, $queries] = $this->sample($provided);
        $this->assertSame(404, $response->getStatusCode());
        $this->assertSame('', $response->getContent());
        $this->assertSame('no-store, private', $response->headers->get('Cache-Control'));
        $this->assertSame([], $queries);
    }

    public function test_http_route_keeps_the_same_bearer_and_metrics_contract(): void
    {
        $this->insertMail('queued', 120);
        $this->withHeader('Authorization', 'bEaReR o97-test-only')->get('/internal/metrics')
            ->assertOk()->assertSee('uvh_mail_outbox_queued 1', false)
            ->assertHeader('X-Content-Type-Options', 'nosniff');
    }

    private function sample(?string $token = 'o97-test-only'): array
    {
        DB::enableQueryLog();
        DB::flushQueryLog();
        try {
            $request = Request::create('/internal/metrics', 'GET', server: $token === null ? [] : ['HTTP_AUTHORIZATION' => 'Bearer '.$token]);
            $response = app(OperationsController::class)->metrics($request);

            return [$response, DB::getQueryLog()];
        } finally {
            DB::disableQueryLog();
        }
    }

    private function assertOneReadPerTable(array $queries): void
    {
        foreach (['mail_outbox', 'webhook_deliveries'] as $table) {
            $reads = array_filter($queries, static fn ($query) => str_contains($query['query'], '"'.$table.'"'));
            $this->assertCount(1, $reads, $table.' must use one fresh SQL snapshot for its counts and oldest pending time');
        }
    }

    private function gauge(string $body, string $name): int
    {
        $this->assertMatchesRegularExpression('/^'.preg_quote($name, '/').' (\d+)$/m', $body);
        preg_match('/^'.preg_quote($name, '/').' (\d+)$/m', $body, $matches);

        return (int) $matches[1];
    }

    private function hook(): int
    {
        $owner = User::factory()->create();
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Synthetic', 'slug' => 'o97-'.bin2hex(random_bytes(4))]);

        return DB::table('webhooks')->insertGetId([
            'workspace_id' => $workspace->id, 'url' => 'https://example.test/webhook', 'secret' => 'synthetic',
            'events' => '[]', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function insertMail(string $status, int $age): int
    {
        return DB::table('mail_outbox')->insertGetId([
            'idempotency_key' => hash('sha256', random_bytes(16)), 'encrypted_envelope' => 'synthetic',
            'kind' => 'synthetic', 'status' => $status, 'created_at' => now()->subSeconds($age), 'updated_at' => now(),
        ]);
    }

    private function insertWebhook(int $hookId, string $status, int $age): int
    {
        return DB::table('webhook_deliveries')->insertGetId([
            'webhook_id' => $hookId, 'event' => 'link.created', 'event_id' => bin2hex(random_bytes(16)),
            'payload' => '{}', 'status' => $status, 'created_at' => now()->subSeconds($age),
        ]);
    }
}
