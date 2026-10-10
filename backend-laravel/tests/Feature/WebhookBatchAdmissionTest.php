<?php

namespace Tests\Feature;

use App\Jobs\WebhookDeliveryJob;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Models\Workspace;
use App\Support\UvhCrypto;
use App\Support\WebhookAdmissionUnavailable;
use App\Support\WebhookService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class WebhookBatchAdmissionTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, workspaces RESTART IDENTITY CASCADE');
        Carbon::setTestNow(Carbon::parse('2026-10-10T10:00:00Z'));
        Queue::fake();
    }

    protected function tearDown(): void
    {
        DB::disableQueryLog();
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_events_keep_their_identity_payload_order_and_subscription_configuration(): void
    {
        [$owner, $workspace] = $this->fixture();
        $first = $this->webhook($workspace, $owner, ['link.updated', 'link.deleted']);
        $second = $this->webhook($workspace, $owner, ['link.updated'], 7);
        DB::transaction(function () use ($workspace): void {
            WebhookService::dispatchMany($workspace->id, [
                ['event' => 'link.updated', 'data' => ['linkId' => 10, 'alias' => 'uno']],
                ['event' => 'link.deleted', 'data' => ['linkId' => 11], 'eventUuid' => 'durable-event'],
                ['event' => 'link.updated', 'data' => ['linkId' => 12]],
            ]);
            Queue::assertNothingPushed();
            $this->assertSame(5, WebhookDelivery::count());
        });

        $deliveries = WebhookDelivery::orderBy('id')->get();
        $this->assertSame([$first->id, $second->id, $first->id, $first->id, $second->id], $deliveries->pluck('webhook_id')->all());
        $this->assertSame([1, 7, 1, 1, 7], $deliveries->pluck('config_version')->all());
        $this->assertSame(['link.updated', 'link.updated', 'link.deleted', 'link.updated', 'link.updated'], $deliveries->pluck('event')->all());
        $this->assertSame($deliveries[0]->event_id, $deliveries[1]->event_id);
        $this->assertSame($deliveries[3]->event_id, $deliveries[4]->event_id);
        $this->assertNotSame($deliveries[0]->event_id, $deliveries[3]->event_id);
        $this->assertSame('durable-event', $deliveries[2]->event_id);
        foreach ($deliveries as $delivery) {
            $this->assertSame($delivery->event_id, $delivery->payload['event_id']);
            $this->assertSame($delivery->event, $delivery->payload['event']);
            $this->assertSame(now()->toIso8601String(), $delivery->payload['timestamp']);
            $this->assertSame('pending', $delivery->status);
            $this->assertNotNull($delivery->locked_at);
        }
        $this->assertSame(['alias' => 'uno', 'linkId' => 10], $deliveries[0]->payload['data']);
        $this->assertSame(['linkId' => 11], $deliveries[2]->payload['data']);
        Queue::assertPushed(WebhookDeliveryJob::class, 5);
        $this->assertSame($deliveries->pluck('id')->all(), Queue::pushed(WebhookDeliveryJob::class)->map(fn ($job) => $job->deliveryId)->all());
    }

    public static function creators(): array
    {
        return [
            'owner' => ['owner', true], 'admin' => ['admin', true], 'editor' => ['editor', true],
            'viewer' => ['viewer', false], 'removed membership' => ['removed', false],
            'deleted account' => ['deleted', false], 'foreign membership' => ['foreign', false],
            'system subscription' => ['system', true], 'inactive' => ['inactive', false],
        ];
    }

    #[DataProvider('creators')]
    public function test_each_batch_rechecks_creator_authority_and_workspace_scope(string $mode, bool $eligible): void
    {
        [$owner, $workspace] = $this->fixture();
        $webhook = $this->webhook($workspace, $owner, ['link.updated']);
        if (in_array($mode, ['admin', 'editor', 'viewer'], true)) {
            DB::table('memberships')->where('workspace_id', $workspace->id)->update(['role' => $mode]);
        } elseif ($mode === 'removed' || $mode === 'foreign') {
            DB::table('memberships')->where('workspace_id', $workspace->id)->delete();
            if ($mode === 'foreign') {
                $other = $owner->ownedWorkspaces()->create(['name' => 'Other', 'slug' => 'other']);
                $other->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
            }
        } elseif ($mode === 'deleted') {
            $owner->update(['deleted_at' => now()]);
        } elseif ($mode === 'system') {
            $webhook->update(['created_by' => null]);
        } elseif ($mode === 'inactive') {
            $webhook->update(['active' => false]);
        }
        DB::transaction(fn () => WebhookService::dispatchMany($workspace->id, $this->events(2)));
        $this->assertSame($eligible ? 2 : 0, WebhookDelivery::count());
        Queue::assertPushed(WebhookDeliveryJob::class, $eligible ? 2 : 0);
        $other = $owner->ownedWorkspaces()->create(['name' => 'Unsubscribed', 'slug' => 'unsubscribed']);
        DB::transaction(fn () => WebhookService::dispatchMany($other->id, $this->events(2)));
        $this->assertSame($eligible ? 2 : 0, WebhookDelivery::count());
    }

    public static function batchSizes(): array
    {
        return [[1], [20], [100]];
    }

    #[DataProvider('batchSizes')]
    public function test_admission_reads_capacity_and_subscriptions_once_without_loading_secrets(int $count): void
    {
        [$owner, $workspace] = $this->fixture();
        $this->webhook($workspace, $owner, ['link.updated']);
        DB::enableQueryLog();
        DB::flushQueryLog();
        DB::transaction(fn () => WebhookService::dispatchMany($workspace->id, $this->events($count)));
        $queries = array_column(DB::getQueryLog(), 'query');
        $this->assertCount(1, array_filter($queries, fn ($sql) => str_contains($sql, 'pg_advisory_xact_lock')));
        $this->assertCount(1, array_filter($queries, fn ($sql) => str_contains($sql, 'from "webhook_deliveries" as "d"')));
        $subscriptions = array_values(array_filter($queries, fn ($sql) => str_starts_with($sql, 'select ') && str_contains($sql, 'from "webhooks" where')));
        $this->assertCount(1, $subscriptions);
        $this->assertStringStartsWith('select "id", "config_version", "events"', $subscriptions[0]);
        $this->assertSame($count, WebhookDelivery::count());
        Queue::assertPushed(WebhookDeliveryJob::class, $count);
    }

    public function test_empty_batch_does_no_admission_work_but_still_requires_a_business_transaction(): void
    {
        DB::enableQueryLog();
        DB::flushQueryLog();
        DB::transaction(fn () => WebhookService::dispatchMany(123, []));
        $this->assertSame([], DB::getQueryLog());
        Queue::assertNothingPushed();
        $this->expectException(WebhookAdmissionUnavailable::class);
        WebhookService::dispatchMany(123, []);
    }

    public function test_parent_rollback_discards_every_delivery_and_queue_callback(): void
    {
        [$owner, $workspace] = $this->fixture();
        $this->webhook($workspace, $owner, ['link.updated']);
        DB::beginTransaction();
        try {
            DB::transaction(fn () => WebhookService::dispatchMany($workspace->id, $this->events(3)));
            $this->assertSame(3, WebhookDelivery::count());
            Queue::assertNothingPushed();
        } finally {
            DB::rollBack();
        }
        $this->assertSame(0, WebhookDelivery::count());
        Queue::assertNothingPushed();
    }

    public static function capacities(): array
    {
        return ['exact capacity' => [998, 2, true], 'overflow after first event' => [999, 2, false], 'full' => [1000, 1, false]];
    }

    #[DataProvider('capacities')]
    public function test_capacity_is_workspace_wide_and_failure_rolls_back_the_entire_batch(int $pending, int $events, bool $success): void
    {
        [$owner, $workspace] = $this->fixture();
        $webhook = $this->webhook($workspace, $owner, ['link.updated']);
        $rows = [];
        for ($i = 0; $i < $pending; $i++) {
            $rows[] = ['webhook_id' => $webhook->id, 'config_version' => 1, 'event' => 'link.updated', 'event_id' => 'prior-'.$i, 'payload' => '{}', 'status' => $i % 2 ? 'pending' : 'processing', 'created_at' => now()];
        }
        DB::table('webhook_deliveries')->insert($rows);
        try {
            DB::transaction(function () use ($workspace, $events): void {
                $workspace->update(['name' => 'Changed']);
                WebhookService::dispatchMany($workspace->id, $this->events($events));
            });
            $this->assertTrue($success, 'Overflow must fail the business transaction');
        } catch (WebhookAdmissionUnavailable $error) {
            $this->assertFalse($success, $error->getMessage());
        }
        $this->assertSame($success ? $pending + $events : $pending, WebhookDelivery::count());
        $this->assertSame($success ? 'Changed' : 'Batch', $workspace->fresh()->name);
        Queue::assertPushed(WebhookDeliveryJob::class, $success ? $events : 0);
    }

    public function test_subscriptions_and_capacity_are_not_cached_between_calls_in_the_same_transaction(): void
    {
        [$owner, $workspace] = $this->fixture();
        $webhook = $this->webhook($workspace, $owner, ['link.updated']);
        DB::transaction(function () use ($workspace, $webhook): void {
            WebhookService::dispatchMany($workspace->id, $this->events(1));
            $webhook->update(['events' => ['link.deleted'], 'config_version' => 2]);
            WebhookService::dispatchMany($workspace->id, $this->events(1));
            WebhookService::dispatch($workspace->id, 'link.deleted', ['linkId' => 9], 'single-stable');
        });
        $this->assertSame(['link.updated', 'link.deleted'], WebhookDelivery::orderBy('id')->pluck('event')->all());
        $this->assertSame([1, 2], WebhookDelivery::orderBy('id')->pluck('config_version')->all());
        Queue::assertPushed(WebhookDeliveryJob::class, 2);
    }

    public function test_a_slot_released_during_admission_is_rechecked_at_the_capacity_boundary(): void
    {
        [$owner, $workspace] = $this->fixture();
        $webhook = $this->webhook($workspace, $owner, ['link.updated']);
        $rows = [];
        for ($i = 0; $i < 999; $i++) {
            $rows[] = ['webhook_id' => $webhook->id, 'config_version' => 1, 'event' => 'link.updated', 'event_id' => 'prior-'.$i, 'payload' => '{}', 'status' => 'pending', 'created_at' => now()];
        }
        DB::table('webhook_deliveries')->insert($rows);
        $release = true;
        // Simulate the visible effect of a worker finishing after the first
        // insert. This exercises refresh semantics, not process concurrency.
        DB::listen(function ($query) use (&$release): void {
            if ($release && str_starts_with($query->sql, 'insert into "webhook_deliveries"')) {
                $release = false;
                DB::table('webhook_deliveries')->where('event_id', 'prior-0')->update(['status' => 'success']);
            }
        });
        try {
            DB::transaction(fn () => WebhookService::dispatchMany($workspace->id, $this->events(2)));
        } finally {
            $release = false;
        }
        $this->assertSame(1000, WebhookDelivery::whereIn('status', ['pending', 'processing'])->count());
        $this->assertSame(1001, WebhookDelivery::count());
        Queue::assertPushed(WebhookDeliveryJob::class, 2);
    }

    /** @return array{User, Workspace} */
    private function fixture(): array
    {
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Batch', 'slug' => 'batch']);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);

        return [$owner, $workspace];
    }

    /** @param list<string> $events */
    private function webhook(Workspace $workspace, User $owner, array $events, int $version = 1): Webhook
    {
        return Webhook::create(['workspace_id' => $workspace->id, 'created_by' => $owner->id, 'url' => 'https://receiver.example.test/hook', 'secret' => UvhCrypto::encryptAtRest('fixture-only-secret'), 'events' => $events, 'active' => true, 'config_version' => $version]);
    }

    /** @return list<array{event: string, data: array<string, mixed>}> */
    private function events(int $count): array
    {
        return array_map(fn ($i) => ['event' => 'link.updated', 'data' => ['linkId' => $i + 1]], range(0, $count - 1));
    }
}
