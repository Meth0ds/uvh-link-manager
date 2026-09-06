<?php

namespace Tests\Feature;

use App\Jobs\WebhookDeliveryJob;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/** Isolated inspector contract; no webhook request is sent to the network. */
final class WebhookInspectorTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'webhook-inspector-csrf')->withHeader('X-CSRF-Token', 'webhook-inspector-csrf');
        Queue::fake();
    }

    public function test_inspector_returns_only_allowlisted_payload_and_normalized_error(): void
    {
        [$owner, $workspace, $webhook] = $this->fixture();
        $delivery = $this->delivery($webhook, [
            'event' => 'link.updated', 'event_id' => 'evt-safe', 'timestamp' => now()->toIso8601String(),
            'data' => [
                'linkId' => 9, 'alias' => 'launch', 'state' => 'active',
                'destination' => 'https://private.example.test/path', 'secret' => 'payload-secret',
            ],
            'signature' => 'private-signature', 'resolvedIp' => '203.0.113.8',
            'responseBody' => str_repeat('remote-private-', 20),
        ], 'failed', 'HTTP 503');

        $this->signIn($owner, $workspace);
        $response = $this->getJson($this->path($webhook))->assertOk()
            ->assertJsonPath('deliveries.0.id', $delivery->id)
            ->assertJsonPath('deliveries.0.error.code', 'receiver_http')
            ->assertJsonPath('deliveries.0.payloadPreview.redacted', true)
            ->assertJsonPath('deliveries.0.payloadPreview.data.linkId', 9)
            ->assertJsonPath('deliveries.0.payloadPreview.data.alias', 'launch')
            ->assertJsonPath('deliveries.0.payloadPreview.data.state', 'active');

        $body = $response->getContent();
        foreach (['payload-secret', 'private-signature', '203.0.113.8', 'remote-private', 'private.example.test', 'last_error'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $body);
        }
    }

    public function test_delivery_history_is_stably_paginated_and_bound_to_the_webhook(): void
    {
        [$owner, $workspace, $webhook] = $this->fixture();
        for ($index = 0; $index < 5; $index++) {
            $this->delivery($webhook, ['event' => 'ping', 'event_id' => 'page-'.$index, 'data' => ['message' => 'UVH webhook test']]);
        }
        [, , $other] = $this->fixture();
        $this->delivery($other, ['event' => 'ping', 'event_id' => 'foreign', 'data' => ['message' => 'foreign']]);

        $this->signIn($owner, $workspace);
        $response = $this->getJson($this->path($webhook).'?page=2&perPage=2')->assertOk()
            ->assertJsonPath('total', 5)->assertJsonPath('page', 2)->assertJsonPath('perPage', 2)
            ->assertJsonCount(2, 'deliveries');
        $this->assertStringNotContainsString('foreign', $response->getContent());
        $this->getJson($this->path($webhook).'?page=0&perPage=2')->assertUnprocessable();
    }

    public function test_viewer_can_inspect_but_cannot_test_or_resend(): void
    {
        [$owner, $workspace, $webhook] = $this->fixture();
        $viewer = User::factory()->create(['email_verified_at' => now()]);
        $workspace->memberships()->create(['user_id' => $viewer->id, 'role' => 'viewer']);
        $delivery = $this->delivery($webhook, ['event' => 'ping', 'event_id' => 'viewer-event', 'data' => ['message' => 'test']], 'failed');

        $this->signIn($viewer, $workspace);
        $this->getJson($this->path($webhook))->assertOk();
        $this->postJson('/api/v1/webhooks/'.$webhook->id.'/test')->assertForbidden();
        $this->postJson('/api/v1/webhooks/'.$webhook->id.'/deliveries/'.$delivery->id.'/resend')->assertForbidden();
        $this->assertNotSame($owner->id, $viewer->id);
    }

    public function test_repeated_resend_of_pending_delivery_is_idempotent(): void
    {
        [$owner, $workspace, $webhook] = $this->fixture();
        $delivery = $this->delivery($webhook, ['event' => 'ping', 'event_id' => 'stable-event', 'data' => ['message' => 'test']], 'pending', 'prior safe error', 3);

        $this->signIn($owner, $workspace);
        $path = '/api/v1/webhooks/'.$webhook->id.'/deliveries/'.$delivery->id.'/resend';
        $this->postJson($path)->assertOk()->assertExactJson(['ok' => true, 'state' => 'pending']);
        $this->postJson($path)->assertOk()->assertExactJson(['ok' => true, 'state' => 'pending']);
        $this->assertDatabaseCount('webhook_deliveries', 1);
        $this->assertDatabaseHas('webhook_deliveries', ['id' => $delivery->id, 'status' => 'pending', 'attempts' => 3, 'last_error' => 'prior safe error']);
        Queue::assertPushed(WebhookDeliveryJob::class, 2);
    }

    /** @return array{User, Workspace, Webhook} */
    private function fixture(): array
    {
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Hooks', 'slug' => 'hooks-'.Ids::randomToken(8)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);
        $webhook = Webhook::create([
            'workspace_id' => $workspace->id, 'created_by' => $owner->id,
            'url' => 'https://hooks.example.test/uvh', 'secret' => UvhCrypto::encryptAtRest('inspector-secret-1234'),
            'events' => ['link.updated'], 'active' => true, 'config_version' => 1,
        ]);

        return [$owner, $workspace, $webhook];
    }

    private function delivery(Webhook $webhook, array $payload, string $status = 'pending', ?string $error = null, int $attempts = 0): WebhookDelivery
    {
        return WebhookDelivery::create([
            'webhook_id' => $webhook->id, 'config_version' => 1,
            'event' => (string) ($payload['event'] ?? 'ping'), 'event_id' => (string) ($payload['event_id'] ?? Ids::randomToken(12)),
            'payload' => $payload, 'status' => $status, 'attempts' => $attempts,
            'last_error' => $error, 'next_attempt_at' => $status === 'pending' ? now() : null,
        ]);
    }

    private function signIn(User $user, Workspace $workspace): void
    {
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $workspace->id);
    }

    private function path(Webhook $webhook): string
    {
        return '/api/v1/webhooks/'.$webhook->id.'/deliveries';
    }
}
