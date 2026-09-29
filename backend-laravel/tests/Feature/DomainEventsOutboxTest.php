<?php

namespace Tests\Feature;

use App\Models\CustomDomain;
use App\Models\User;
use App\Models\Webhook;
use App\Support\DomainEvents;
use App\Support\Ids;
use App\Support\UvhCrypto;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * The domain event outbox under concurrency and channel failure.
 *
 * Two consumers run over the same rows (the post-commit fan-out job and the
 * housekeeping sweep), so delivery must elect exactly one sender per event and
 * the external `event_id` must survive every retry so receivers can
 * deduplicate. The two fan-out channels are independent: a saturated webhook
 * backlog must never swallow the alert a domain owner needs. Regression
 * contracts: run only with the isolated *_test DB guard.
 */
final class DomainEventsOutboxTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp(); // Refuses non-*_test databases before fixture writes.
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, quotas, links, custom_domains, custom_domain_claims, domain_events, notifications, notification_preferences, webhooks, webhook_deliveries, audit_events, operational_metrics, mail_outbox RESTART IDENTITY CASCADE');
        Queue::fake();
    }

    public function test_a_claim_elects_one_consumer_and_an_active_lease_blocks_the_second(): void
    {
        [$workspaceId, $domainId, $domain] = $this->domainContext();
        $webhook = $this->webhook($workspaceId, ['domain.offline']);
        $eventId = $this->record($workspaceId, $domainId, $domain, 'domain.offline', ['reason' => 'dns_failed']);

        // Another consumer already claimed this delivery: its lease is active.
        DB::table('domain_events')->where('id', $eventId)->update(['locked_at' => now()]);

        $this->assertFalse(DomainEvents::deliver($eventId));
        $this->assertSame(0, DB::table('webhook_deliveries')->where('webhook_id', $webhook->id)->count());
        $this->assertSame(0, DB::table('notifications')->count());

        // The lease expires and a later consumer recovers the delivery.
        DB::table('domain_events')->where('id', $eventId)->update(['locked_at' => now()->subMinutes(15)]);

        $this->assertTrue(DomainEvents::deliver($eventId));
        $this->assertSame(1, DB::table('webhook_deliveries')->where('webhook_id', $webhook->id)->count());
        $this->assertSame(1, DB::table('notifications')->count());
        $this->assertNotNull(DB::table('domain_events')->where('id', $eventId)->value('dispatched_at'));
    }

    public function test_the_external_event_id_is_the_stable_event_uuid_across_redeliveries(): void
    {
        [$workspaceId, $domainId, $domain] = $this->domainContext();
        $webhook = $this->webhook($workspaceId, ['domain.verified']);
        $eventId = $this->record($workspaceId, $domainId, $domain, 'domain.verified');

        $this->assertTrue(DomainEvents::deliver($eventId));

        $eventUuid = (string) DB::table('domain_events')->where('id', $eventId)->value('event_uuid');
        $this->assertNotSame('', $eventUuid);
        $first = DB::table('webhook_deliveries')->where('webhook_id', $webhook->id)->first();
        $this->assertSame($eventUuid, (string) $first->event_id);
        $this->assertSame($eventUuid, (string) (json_decode((string) $first->payload, true)['event_id'] ?? ''));

        // A crash between the webhook commit and the channel mark re-delivers;
        // the receiver must see the same event_id to deduplicate.
        DB::table('domain_events')->where('id', $eventId)->update([
            'webhook_dispatched_at' => null,
            'dispatched_at' => null,
            'locked_at' => null,
        ]);

        $this->assertTrue(DomainEvents::deliver($eventId));

        $this->assertSame(2, DB::table('webhook_deliveries')->where('webhook_id', $webhook->id)->count());
        $ids = DB::table('webhook_deliveries')->where('webhook_id', $webhook->id)->pluck('event_id')->all();
        $this->assertSame([$eventUuid, $eventUuid], array_map('strval', $ids));
    }

    public function test_a_full_webhook_backlog_never_swallows_the_owner_alert(): void
    {
        [$workspaceId, $domainId, $domain] = $this->domainContext();
        $webhook = $this->webhook($workspaceId, ['domain.offline']);
        $this->fillWebhookBacklog($webhook->id);
        $eventId = $this->record($workspaceId, $domainId, $domain, 'domain.offline', ['reason' => 'dns_failed']);

        // The webhook channel is deferred, so the row is not finished...
        $this->assertFalse(DomainEvents::deliver($eventId));

        // ...but the alert reached the inbox and the owner's mail outbox.
        $this->assertSame(1, DB::table('notifications')->where('kind', 'domain_offline')->count());
        $this->assertSame(1, DB::table('mail_outbox')->where('kind', 'domain_offline')->count());
        // ...while the webhook channel alone is deferred on its own schedule.
        $row = DB::table('domain_events')->where('id', $eventId)->first();
        $this->assertNull($row->webhook_dispatched_at);
        $this->assertNotNull($row->notice_dispatched_at);
        $this->assertNull($row->dispatched_at);
        $this->assertSame(1, (int) $row->attempts);
        $this->assertSame(0, DB::table('webhook_deliveries')->where('webhook_id', $webhook->id)
            ->where('event', 'domain.offline')->count());
    }

    public function test_the_webhook_channel_gives_up_on_its_own_budget_after_the_alert_was_delivered(): void
    {
        [$workspaceId, $domainId, $domain] = $this->domainContext();
        $webhook = $this->webhook($workspaceId, ['domain.offline']);
        $this->fillWebhookBacklog($webhook->id);
        $eventId = $this->record($workspaceId, $domainId, $domain, 'domain.offline', ['reason' => 'dns_failed']);
        // One attempt away from the per-channel budget.
        DB::table('domain_events')->where('id', $eventId)->update(['attempts' => 5]);

        $this->assertTrue(DomainEvents::deliver($eventId));

        $row = DB::table('domain_events')->where('id', $eventId)->first();
        $this->assertNotNull($row->webhook_dispatched_at);
        $this->assertNotNull($row->notice_dispatched_at);
        $this->assertNotNull($row->dispatched_at);
        $this->assertSame(1, DB::table('notifications')->where('kind', 'domain_offline')->count());
    }

    public function test_a_redelivery_of_the_same_event_never_duplicates_the_inbox_row(): void
    {
        [$workspaceId, $domainId, $domain] = $this->domainContext();
        $eventId = $this->record($workspaceId, $domainId, $domain, 'domain.offline', ['reason' => 'dns_failed']);

        $this->assertTrue(DomainEvents::deliver($eventId));
        // Crash semantics again: the notice channel appears unfinished.
        DB::table('domain_events')->where('id', $eventId)->update([
            'notice_dispatched_at' => null,
            'dispatched_at' => null,
            'locked_at' => null,
        ]);

        $this->assertTrue(DomainEvents::deliver($eventId));

        $this->assertSame(1, DB::table('notifications')->where('kind', 'domain_offline')->count());
        $this->assertSame(1, DB::table('mail_outbox')->where('kind', 'domain_offline')->count());
    }

    public function test_every_recorded_event_gets_its_own_external_identity(): void
    {
        [$workspaceId, $domainId, $domain] = $this->domainContext();
        $first = $this->record($workspaceId, $domainId, $domain, 'domain.offline', ['reason' => 'dns_failed']);
        $second = $this->record($workspaceId, $domainId, $domain, 'domain.offline', ['reason' => 'dns_failed']);

        $a = (string) DB::table('domain_events')->where('id', $first)->value('event_uuid');
        $b = (string) DB::table('domain_events')->where('id', $second)->value('event_uuid');
        $this->assertNotSame('', $a);
        $this->assertNotSame('', $b);
        $this->assertNotSame($a, $b);
    }

    /** @return array{0: int, 1: int, 2: string} */
    private function domainContext(): array
    {
        $user = User::factory()->create();
        $workspace = $user->ownedWorkspaces()->create([
            'name' => 'Outbox', 'slug' => 'outbox-'.Ids::randomToken(8),
        ]);
        $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
        $domain = CustomDomain::create([
            'workspace_id' => $workspace->id,
            'domain' => 'out-'.Ids::randomToken(6).'.example.test',
            'verification_token' => 'uvh-verify=Outbox1234',
            'verification_version' => 1,
            'verification_scheme' => 2,
            'desired_state' => 'enabled',
            'ownership_status' => 'verified',
            'routing_status' => 'healthy',
            'tls_status' => 'ready',
            'verified_at' => Carbon::now()->subDay(),
            'ownership_verified_at' => Carbon::now()->subDay(),
            'routing_verified_at' => Carbon::now()->subDay(),
            'edge_eligible' => true,
            'tls_ready_at' => Carbon::now()->subDay(),
        ]);

        return [(int) $workspace->id, (int) $domain->id, $domain->domain];
    }

    /**
     * @param  list<string>  $events
     */
    private function webhook(int $workspaceId, array $events): Webhook
    {
        $user = User::whereHas('ownedWorkspaces', fn ($query) => $query->where('workspaces.id', $workspaceId))->firstOrFail();

        return Webhook::create([
            'workspace_id' => $workspaceId,
            'created_by' => $user->id,
            'url' => 'https://receiver.example.test/hook',
            'secret' => UvhCrypto::encryptAtRest('outbox-test-secret'),
            'events' => $events,
            'active' => true,
            'config_version' => 1,
        ]);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function record(int $workspaceId, int $domainId, string $domain, string $event, array $payload = []): int
    {
        return DB::transaction(fn (): int => DomainEvents::record($workspaceId, $domainId, $domain, $event, $payload));
    }

    private function fillWebhookBacklog(int $webhookId): void
    {
        $rows = [];
        for ($i = 0; $i < 1000; $i++) {
            $rows[] = [
                'webhook_id' => $webhookId,
                'config_version' => 1,
                'event' => 'link.created',
                'event_id' => 'backlog-'.$i,
                'payload' => json_encode(['event' => 'link.created']),
                'status' => 'pending',
                'attempts' => 0,
                'next_attempt_at' => now(),
                'created_at' => now(),
            ];
        }
        DB::table('webhook_deliveries')->insert($rows);
    }
}
