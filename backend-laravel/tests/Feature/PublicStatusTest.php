<?php

namespace Tests\Feature;

use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** The public page may trust only the separately operated monitor contract. */
final class PublicStatusTest extends TestCase
{
    private const FEED = 'https://status-monitor.example.test/uvh.json';

    protected function setUp(): void
    {
        parent::setUp();
        // TestCase installs a default hCaptcha fake. Use an isolated HTTP
        // factory so its catch-all callback cannot satisfy monitor requests.
        Http::swap(new HttpFactory());
    }

    public function test_external_feed_is_minimized_and_overall_is_recalculated(): void
    {
        config([
            'uvh.public_status.feed_url' => self::FEED,
            'uvh.public_status.feed_bearer' => 'private-monitor-token',
            'uvh.public_status.max_age_seconds' => 300,
        ]);
        Http::fake([self::FEED => Http::response([
            'generatedAt' => now()->toIso8601String(),
            'overall' => 'operational', // Untrusted: the API derives its own aggregate.
            'version' => 'must-not-leak',
            'topology' => ['database' => 'db.internal'],
            'components' => ['links' => 'operational', 'panel' => 'degraded', 'webhooks' => 'maintenance'],
            'incidents' => [[
                'id' => 'inc-2026-09', 'title' => 'Latencia elevada',
                'message' => 'Seguimos la recuperación.', 'status' => 'monitoring',
                'startedAt' => now()->subMinutes(10)->toIso8601String(),
                'updatedAt' => now()->subMinute()->toIso8601String(),
                'private' => 'must-not-leak',
            ]],
        ])]);

        $response = $this->getJson('/api/v1/public-status')->assertOk()
            ->assertJsonPath('overall', 'degraded')
            ->assertJsonPath('source', 'external_monitor')
            ->assertJsonPath('components.0.label', 'Enlaces y redirecciones')
            ->assertJsonPath('components.1.label', 'Panel y API')
            ->assertJsonCount(3, 'components')->assertJsonCount(1, 'incidents');
        foreach (['must-not-leak', 'db.internal', 'private-monitor-token', 'topology', 'version'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $response->getContent());
        }
        Http::assertSent(fn (Request $request) => $request->url() === self::FEED
            && $request->hasHeader('Authorization', 'Bearer private-monitor-token'));
    }

    public function test_unconfigured_feed_fails_closed_without_an_outbound_request(): void
    {
        config(['uvh.public_status.feed_url' => '', 'uvh.public_status.feed_bearer' => '']);
        Http::fake();

        $this->getJson('/api/v1/public-status')->assertStatus(503)->assertExactJson($this->unavailable());
        Http::assertNothingSent();
    }

    public function test_stale_feed_is_never_presented_as_healthy(): void
    {
        config(['uvh.public_status.feed_url' => self::FEED, 'uvh.public_status.max_age_seconds' => 60]);
        Http::fake([self::FEED => Http::response($this->feed(now()->subMinutes(5)->toIso8601String()))]);

        $this->getJson('/api/v1/public-status')->assertStatus(503)
            ->assertJsonPath('overall', 'unknown')->assertJsonPath('stale', true)
            ->assertJsonPath('source', 'external_monitor');
    }

    public function test_malformed_feed_fails_closed_and_does_not_echo_its_content(): void
    {
        config(['uvh.public_status.feed_url' => self::FEED]);
        Http::fake([self::FEED => Http::response([
            'generatedAt' => now()->toIso8601String(),
            'components' => ['links' => 'operational', 'panel' => 'compromised', 'webhooks' => 'operational'],
            'incidents' => [['message' => 'sensitive upstream body']],
        ])]);

        $response = $this->getJson('/api/v1/public-status')->assertStatus(503)->assertExactJson($this->unavailable());
        $this->assertStringNotContainsString('sensitive upstream body', $response->getContent());
    }

    public function test_local_or_future_dated_feed_cannot_claim_health(): void
    {
        config(['uvh.public_status.feed_url' => 'https://127.0.0.1/status']);
        Http::fake();
        $this->getJson('/api/v1/public-status')->assertStatus(503)->assertExactJson($this->unavailable());
        Http::assertNothingSent();

        config(['uvh.public_status.feed_url' => self::FEED]);
        Http::fake([self::FEED => Http::response($this->feed(now()->addMinutes(10)->toIso8601String()))]);
        $this->getJson('/api/v1/public-status')->assertStatus(503)->assertExactJson($this->unavailable());
    }

    private function feed(string $generatedAt): array
    {
        return ['generatedAt' => $generatedAt,
            'components' => ['links' => 'operational', 'panel' => 'operational', 'webhooks' => 'operational'],
            'incidents' => []];
    }

    private function unavailable(): array
    {
        return ['overall' => 'unknown', 'generatedAt' => null, 'stale' => true,
            'source' => 'external_monitor_unavailable', 'components' => [], 'incidents' => []];
    }
}
