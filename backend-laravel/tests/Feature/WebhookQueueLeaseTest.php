<?php

namespace Tests\Feature;

use App\Jobs\WebhookDeliveryJob;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Models\Workspace;
use App\Support\WebhookService;
use Illuminate\Contracts\Bus\Dispatcher;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Mockery;
use Tests\TestCase;

final class WebhookQueueLeaseTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users CASCADE');
    }

    public function test_pending_delivery_is_not_republished_until_queue_lease_expires(): void
    {
        Queue::fake();
        $delivery = $this->pendingDelivery('lease');

        WebhookService::enqueueExisting($delivery->id);
        WebhookService::enqueueExisting($delivery->id);
        Queue::assertPushed(WebhookDeliveryJob::class, 1);
        $this->assertTrue($delivery->fresh()->locked_at->greaterThan(now()->subSeconds(10)));

        // A lost queue job becomes recoverable after the bounded publication
        // lease rather than leaving the delivery permanently suppressed.
        $this->travel(11)->minutes();
        WebhookService::enqueueExisting($delivery->id);
        Queue::assertPushed(WebhookDeliveryJob::class, 2);
    }

    public function test_failed_queue_publication_shortens_lease_for_early_retry(): void
    {
        $delivery = $this->pendingDelivery('failure');
        $dispatcher = Mockery::mock(Dispatcher::class);
        $dispatcher->shouldReceive('dispatch')->once()->andThrow(new \RuntimeException('queue unavailable'));
        $this->app->instance(Dispatcher::class, $dispatcher);

        WebhookService::enqueueExisting($delivery->id);

        $fresh = $delivery->fresh();
        $retryAt = $fresh->next_attempt_at;
        $this->assertSame('pending', $fresh->status);
        $this->assertNull($fresh->locked_at);
        $this->assertTrue($retryAt->betweenIncluded(now()->addSeconds(50), now()->addSeconds(70)));
    }

    private function pendingDelivery(string $suffix): WebhookDelivery
    {
        $owner = User::factory()->create();
        $workspace = Workspace::create([
            'name' => 'Queue lease',
            'slug' => 'queue-'.$suffix,
            'owner_user_id' => $owner->id,
        ]);
        $webhook = Webhook::create([
            'workspace_id' => $workspace->id,
            'created_by' => $owner->id,
            'url' => 'https://example.com/webhook',
            'secret' => 'unused-encrypted-secret',
            'events' => ['link.created'],
            'active' => true,
            'config_version' => 1,
        ]);

        return WebhookDelivery::create([
            'webhook_id' => $webhook->id,
            'config_version' => 1,
            'event' => 'link.created',
            'event_id' => 'queue-'.$suffix.'-event',
            'payload' => ['event' => 'link.created', 'event_id' => 'queue-'.$suffix.'-event'],
            'status' => 'pending',
            'next_attempt_at' => now(),
        ]);
    }
}
