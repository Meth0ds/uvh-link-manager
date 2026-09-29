<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use App\Support\WebhookEvents;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * The event catalog as an API contract: every catalog event is subscribable
 * and the delivery inspector projects domain payloads through the shared
 * allowlist — internal and cross-tenant fields never reach a viewer or a
 * receiver. Isolated contract; no webhook request is sent to the network.
 */
final class WebhookEventCatalogTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'webhook-catalog-csrf')->withHeader('X-CSRF-Token', 'webhook-catalog-csrf');
        Queue::fake();
    }

    public function test_the_api_accepts_subscriptions_to_every_catalog_event(): void
    {
        [$owner, $workspace] = $this->fixture();

        $this->signIn($owner, $workspace);
        $response = $this->postJson('/api/v1/webhooks', [
            'url' => 'https://hooks.example.test/uvh',
            'events' => WebhookEvents::all(),
        ])->assertCreated();

        $this->assertSame(WebhookEvents::all(), $response->json('webhook.events'));
    }

    public function test_unknown_events_are_rejected_and_new_domain_events_are_not(): void
    {
        [$owner, $workspace] = $this->fixture();

        $this->signIn($owner, $workspace);
        // The event the old catalog forgot: subscribing must succeed, which is
        // the whole point of the single catalog.
        $this->postJson('/api/v1/webhooks', [
            'url' => 'https://hooks.example.test/uvh',
            'events' => ['domain.offline'],
        ])->assertCreated();
        $this->postJson('/api/v1/webhooks', [
            'url' => 'https://hooks.example.test/uvh',
            'events' => ['domain.exploded'],
        ])->assertUnprocessable();
    }

    public function test_the_delivery_preview_projects_domain_payloads_without_internal_ids(): void
    {
        [$owner, $workspace] = $this->fixture();
        $webhook = Webhook::create([
            'workspace_id' => $workspace->id, 'created_by' => $owner->id,
            'url' => 'https://hooks.example.test/uvh', 'secret' => UvhCrypto::encryptAtRest('catalog-secret-123456'),
            'events' => ['domain.degraded'], 'active' => true, 'config_version' => 1,
        ]);
        $delivery = WebhookDelivery::create([
            'webhook_id' => $webhook->id, 'config_version' => 1,
            'event' => 'domain.degraded', 'event_id' => 'stable-evt-1',
            'payload' => [
                'event' => 'domain.degraded', 'event_id' => 'stable-evt-1',
                'timestamp' => now()->toIso8601String(),
                'data' => [
                    'domainId' => 81, 'domain' => 'go.example.test', 'reason' => 'routing_missing',
                    'failureCount' => 2, 'graceExpiresAt' => now()->addHour()->toIso8601String(),
                    // Internal and cross-tenant fields a producer may carry.
                    'previousWorkspaceId' => 7, 'newWorkspaceId' => 9,
                    'internalNote' => 'never leaves the platform',
                ],
            ],
            'status' => 'pending', 'attempts' => 0, 'next_attempt_at' => now(),
        ]);

        $this->signIn($owner, $workspace);
        $response = $this->getJson('/api/v1/webhooks/'.$webhook->id.'/deliveries')->assertOk()
            ->assertJsonPath('deliveries.0.payloadPreview.event', 'domain.degraded')
            ->assertJsonPath('deliveries.0.payloadPreview.data.domainId', 81)
            ->assertJsonPath('deliveries.0.payloadPreview.data.domain', 'go.example.test')
            ->assertJsonPath('deliveries.0.payloadPreview.data.reason', 'routing_missing')
            ->assertJsonPath('deliveries.0.payloadPreview.data.failureCount', 2);

        $body = $response->getContent();
        foreach (['previousWorkspaceId', 'newWorkspaceId', 'internalNote', 'never leaves'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $body);
        }
        $this->assertSame(5, count((array) ($response->json('deliveries.0.payloadPreview.data') ?? [])));
        $this->assertSame($delivery->id, (int) $response->json('deliveries.0.id'));
    }

    /** @return array{User, Workspace} */
    private function fixture(): array
    {
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Catalog', 'slug' => 'catalog-'.Ids::randomToken(8)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);

        return [$owner, $workspace];
    }

    private function signIn(User $user, Workspace $workspace): void
    {
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $workspace->id);
    }
}
