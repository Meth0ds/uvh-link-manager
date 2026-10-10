<?php

namespace Tests\Feature;

use App\Jobs\RecordClickAnalyticsJob;
use App\Models\ApiToken;
use App\Models\User;
use App\Support\Ids;
use App\Support\SessionManager;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Real HTTP predicates, array-cache hits and PostgreSQL timestamp storage. */
final class AnalyticsRangePrecisionTest extends TestCase
{
    private int $linkId;

    private int $workspaceId;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, operational_metrics RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        config(['uvh.analytics.overview_cache_seconds' => 0]);
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Precision', 'slug' => 'precision-'.Ids::randomToken(8)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $this->workspaceId = $workspace->id;
        $this->linkId = DB::table('links')->insertGetId([
            'workspace_id' => $workspace->id, 'created_by' => $owner->id,
            'alias' => 'precision', 'destination' => 'https://example.test/precision', 'state' => 'active',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->withCookie((string) config('uvh.session_cookie'), SessionManager::create($owner->id, Request::create('/'), (int) $owner->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $workspace->id);
        ApiToken::forceCreate([
            'workspace_id' => $workspace->id, 'created_by' => $owner->id, 'name' => 'precision',
            'token_hash' => Ids::sha256Hex('analytics-precision-fixture'), 'scopes' => ['analytics:read'],
        ]);
    }

    public static function consumers(): array
    {
        return [['overview'], ['public'], ['json'], ['csv']];
    }

    #[DataProvider('consumers')]
    public function test_exact_fractional_bounds_are_inclusive_without_widening_the_window(string $consumer): void
    {
        foreach (['.099999', '.100000', '.150000', '.200000', '.200001'] as $fraction) {
            $this->event('2026-01-01T12:00:00'.$fraction.'Z');
        }
        $this->assertClicks($consumer, ['period' => 'custom', 'from' => '2026-01-01T13:00:00.1+01:00', 'to' => '2026-01-01T12:00:00.200000Z'], 3);
        $this->assertClicks($consumer, ['period' => 'custom', 'from' => '2026-01-01T12:00:00.100000Z', 'to' => '2026-01-01T13:00:00.2+01:00'], 3);
    }

    #[DataProvider('consumers')]
    public function test_a_date_only_end_includes_the_last_microsecond_but_not_the_next_day(string $consumer): void
    {
        $this->event('2026-01-01T00:00:00.000000Z');
        $this->event('2026-01-01T23:59:59.999999Z');
        $this->event('2026-01-02T00:00:00.000000Z');
        $this->assertClicks($consumer, ['period' => 'custom', 'from' => '2026-01-01', 'to' => '2026-01-01'], 2);
    }

    #[DataProvider('consumers')]
    public function test_the_180_day_limit_counts_fractions_and_elapsed_time_across_offsets(string $consumer): void
    {
        $start = CarbonImmutable::parse('2026-01-01T12:00:00.123456Z');
        $end = $start->addDays(180);
        $bounds = ['period' => 'custom', 'from' => $start->setTimezone('+02:00')->format('Y-m-d\TH:i:s.uP')];
        $this->assertClicks($consumer, $bounds + ['to' => $end->setTimezone('-05:00')->format('Y-m-d\TH:i:s.uP')], 0);
        $this->getJson($this->path($consumer, $bounds + ['to' => $end->addMicrosecond()->format('Y-m-d\TH:i:s.uP')]))->assertUnprocessable();
    }

    public static function explicitRanges(): array
    {
        $cases = [];
        foreach (['custom', '7d'] as $period) {
            foreach (['overview', 'public', 'json', 'csv'] as $consumer) {
                $cases[] = [$period, $consumer];
            }
        }

        return $cases;
    }

    #[DataProvider('explicitRanges')]
    public function test_explicit_bounds_near_now_do_not_share_a_rolling_cache_entry(string $period, string $consumer): void
    {
        config(['uvh.analytics.overview_cache_seconds' => 30]);
        // Both ends live in the same second and TTL bucket, including when the
        // wall clock is at a bucket boundary. Their event sets still differ.
        $end = CarbonImmutable::createFromTimestamp(time(), 'UTC');
        $this->event($end->addMicroseconds(500000)->format('Y-m-d\TH:i:s.uP'));
        $bounds = ['period' => $period, 'from' => $end->subMinute()->format('Y-m-d\TH:i:s.uP')];
        $this->assertClicks($consumer, $bounds + ['to' => $end->addMicroseconds(250000)->format('Y-m-d\TH:i:s.uP')], 0);
        $this->assertClicks($consumer, $bounds + ['to' => $end->addMicroseconds(750000)->format('Y-m-d\TH:i:s.uP')], 1);
    }

    public function test_a_preset_with_only_from_is_exact_while_a_true_rolling_period_reuses_its_bucket(): void
    {
        config(['uvh.analytics.overview_cache_seconds' => 30]);
        $anchor = CarbonImmutable::parse('2026-01-01T12:00:05Z');
        $this->event($anchor->addSecond()->format('Y-m-d\TH:i:s.uP'));
        $this->travelTo($anchor);
        try {
            $this->assertClicks('overview', ['period' => '7d', 'from' => $anchor->subMinute()->format('Y-m-d\TH:i:s.uP')], 0);
            $this->assertClicks('overview', ['period' => '7d'], 0);
            $this->travelTo($anchor->addSeconds(2));
            $this->assertClicks('overview', ['period' => '7d', 'from' => $anchor->subMinute()->format('Y-m-d\TH:i:s.uP')], 1);
            $this->assertClicks('overview', ['period' => '7d'], 0);
            $this->assertClicks('overview', ['period' => '7d', 'linkId' => $this->linkId], 1);
            $this->travelTo($anchor->addSeconds(31));
            $this->assertClicks('overview', ['period' => '7d'], 1);
        } finally {
            $this->travelBack();
        }
    }

    #[DataProvider('consumers')]
    public function test_a_preset_with_only_to_uses_its_exact_bounds(string $consumer): void
    {
        config(['uvh.analytics.overview_cache_seconds' => 30]);
        $end = CarbonImmutable::createFromTimestamp(time(), 'UTC');
        $this->event($end->addMicroseconds(500000)->format('Y-m-d\TH:i:s.uP'));
        $this->assertClicks($consumer, ['period' => '7d', 'to' => $end->addMicroseconds(250000)->format('Y-m-d\TH:i:s.uP')], 0);
        $this->assertClicks($consumer, ['period' => '7d', 'to' => $end->addMicroseconds(750000)->format('Y-m-d\TH:i:s.uP')], 1);
    }

    #[DataProvider('consumers')]
    public function test_a_cache_hit_cannot_bypass_revoked_authority(string $consumer): void
    {
        config(['uvh.analytics.overview_cache_seconds' => 30]);
        $bounds = ['period' => 'custom', 'from' => '2026-01-01', 'to' => '2026-01-01'];
        $this->event('2026-01-01T12:00:00Z');
        $this->assertClicks($consumer, $bounds, 1);
        if ($consumer === 'public') {
            DB::table('api_tokens')->where('workspace_id', $this->workspaceId)->update(['revoked_at' => now()]);
            $this->getJson($this->path($consumer, $bounds))->assertUnauthorized();
        } else {
            DB::table('memberships')->where('workspace_id', $this->workspaceId)->delete();
            $this->getJson($this->path($consumer, $bounds))->assertForbidden();
        }
    }

    public function test_precision_migration_is_reversible_without_rounding_existing_events(): void
    {
        $migration = require database_path('migrations/2026_10_09_000002_preserve_click_event_precision.php');
        $this->event('2026-01-01T23:59:59.999999Z');
        try {
            try {
                $migration->down();
                $this->fail('Fractional events must prevent a lossy rollback');
            } catch (\RuntimeException $error) {
                $this->assertSame('Cannot reduce click event precision while fractional instants exist', $error->getMessage());
            }
            $this->assertSame(6, (int) DB::selectOne("SELECT datetime_precision FROM information_schema.columns WHERE table_name = 'click_events' AND column_name = 'occurred_at'")->datetime_precision);
            $this->assertSame('2026-01-01T23:59:59.999999+00:00', CarbonImmutable::parse(DB::table('click_events')->value('occurred_at'))->utc()->format('Y-m-d\TH:i:s.uP'));
            DB::table('click_events')->delete();
            $this->event('2026-01-01T12:00:00Z');
            $migration->down();
            $this->assertSame(0, (int) DB::selectOne("SELECT datetime_precision FROM information_schema.columns WHERE table_name = 'click_events' AND column_name = 'occurred_at'")->datetime_precision);
            $migration->up();
            $this->assertSame(6, (int) DB::selectOne("SELECT datetime_precision FROM information_schema.columns WHERE table_name = 'click_events' AND column_name = 'occurred_at'")->datetime_precision);
            $this->assertSame('2026-01-01T12:00:00.000000+00:00', CarbonImmutable::parse(DB::table('click_events')->value('occurred_at'))->utc()->format('Y-m-d\TH:i:s.uP'));
        } finally {
            $migration->up();
        }
    }

    public function test_a_cached_range_is_scoped_to_its_workspace(): void
    {
        config(['uvh.analytics.overview_cache_seconds' => 30]);
        $bounds = ['period' => 'custom', 'from' => '2026-01-01', 'to' => '2026-01-01'];
        $this->event('2026-01-01T12:00:00Z');
        $this->assertClicks('overview', $bounds, 1);
        $owner = User::findOrFail(DB::table('links')->where('id', $this->linkId)->value('created_by'));
        $otherWorkspace = $owner->ownedWorkspaces()->create(['name' => 'Other', 'slug' => 'other-'.Ids::randomToken(8)]);
        $otherWorkspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $this->withHeader('X-Workspace-Id', (string) $otherWorkspace->id);
        $this->assertClicks('overview', $bounds, 0);
        $this->getJson($this->path('overview', $bounds + ['linkId' => $this->linkId]))->assertNotFound();
        $this->withHeader('X-Workspace-Id', (string) $this->workspaceId);
        $this->assertClicks('overview', $bounds, 1);
    }

    public function test_redirect_job_preserves_microseconds_on_storage_and_duplicate_delivery(): void
    {
        $instant = CarbonImmutable::parse('2026-01-01T23:59:59.987654Z');
        Queue::fake([RecordClickAnalyticsJob::class]);
        $this->travelTo($instant);
        try {
            $this->get('https://uvh.es/precision', ['User-Agent' => 'Precision fixture browser'])->assertRedirect('https://example.test/precision');
            $job = Queue::pushed(RecordClickAnalyticsJob::class)->first();
            $this->assertInstanceOf(RecordClickAnalyticsJob::class, $job);
            $this->assertSame($instant->format('Y-m-d\TH:i:s.uP'), $job->occurredAt);
            $this->assertArrayNotHasKey('ip', $job->meta);
            $this->assertArrayNotHasKey('user_agent', $job->meta);
            $job->handle();
            $job->handle();
            $stored = DB::table('click_events')->where('event_id', $job->eventId)->value('occurred_at');
            $this->assertSame($instant->format('Y-m-d\TH:i:s.uP'), CarbonImmutable::parse($stored)->utc()->format('Y-m-d\TH:i:s.uP'));
            $this->assertSame(1, DB::table('click_events')->count());
            $this->assertSame(1, (int) DB::table('metric_rollups')->where('link_id', $this->linkId)->value('clicks'));
            $this->assertSame(1, (int) DB::table('links')->where('id', $this->linkId)->value('click_count'));
        } finally {
            $this->travelBack();
        }
    }

    public function test_job_storage_keeps_the_original_utc_day_and_fraction(): void
    {
        $job = new RecordClickAnalyticsJob((string) Str::uuid(), $this->linkId, '2026-01-02T01:00:00.123456+02:00', []);
        $job->handle();
        $job->handle();
        $stored = DB::table('click_events')->where('event_id', $job->eventId)->value('occurred_at');
        $this->assertSame('2026-01-01T23:00:00.123456+00:00', CarbonImmutable::parse($stored)->utc()->format('Y-m-d\TH:i:s.uP'));
        $this->assertSame('2026-01-01', (string) DB::table('metric_rollups')->where('link_id', $this->linkId)->value('day'));
        $this->assertSame(1, DB::table('click_events')->count());
        $this->assertSame(1, (int) DB::table('metric_rollups')->where('link_id', $this->linkId)->value('clicks'));
    }

    private function event(string $instant): void
    {
        DB::table('click_events')->insert(['event_id' => (string) Str::uuid(), 'link_id' => $this->linkId, 'occurred_at' => $instant, 'password_ok' => true]);
    }

    private function path(string $consumer, array $query): string
    {
        if ($consumer === 'public') {
            $this->withHeader('Authorization', 'Bearer analytics-precision-fixture');
        }
        $path = $consumer === 'public' ? '/api/v1/analytics/public/overview' : '/api/v1/analytics/'.($consumer === 'overview' ? 'overview' : 'export');
        if (in_array($consumer, ['json', 'csv'], true)) {
            $query['format'] = $consumer;
        }

        return $path.'?'.http_build_query($query);
    }

    private function assertClicks(string $consumer, array $query, int $clicks): void
    {
        $response = $this->getJson($this->path($consumer, $query))->assertOk();
        if ($consumer === 'csv') {
            $this->assertStringContainsString('totals,,,'.$clicks.',0', (string) $response->getContent());
        } else {
            $response->assertJsonPath('totals.clicks', $clicks);
            $this->assertSame($clicks, array_sum(array_column($response->json('series'), 'clicks')));
        }
    }
}
