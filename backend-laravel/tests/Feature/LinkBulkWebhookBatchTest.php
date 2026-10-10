<?php

namespace Tests\Feature;

use App\Jobs\WebhookDeliveryJob;
use App\Models\CustomDomain;
use App\Models\Link;
use App\Models\Tag;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Models\Workspace;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class LinkBulkWebhookBatchTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, workspaces, audit_events, idempotency_keys RESTART IDENTITY CASCADE');
        Carbon::setTestNow(Carbon::parse('2026-10-10T10:00:00Z'));
        Queue::fake();
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'batch-csrf')->withHeader('X-CSRF-Token', 'batch-csrf');
    }

    protected function tearDown(): void
    {
        DB::disableQueryLog();
        Carbon::setTestNow();
        parent::tearDown();
    }

    public static function actions(): array
    {
        return array_map(fn ($action) => [$action], ['pause', 'activate', 'archive', 'trash', 'restore', 'tag', 'untag', 'move', 'set-domain']);
    }

    #[DataProvider('actions')]
    public function test_all_actions_admit_one_batch_preserve_events_and_replay_without_new_deliveries(string $action): void
    {
        [$owner, $workspace, $ids, $webhook] = $this->fixture(3);
        $body = ['action' => $action, 'linkIds' => array_reverse($ids)];
        if ($action === 'activate') {
            Link::whereIn('id', $ids)->update(['state' => 'paused']);
        } elseif ($action === 'restore') {
            Link::whereIn('id', $ids)->update(['state' => 'deleted', 'state_before_delete' => 'paused', 'deleted_at' => now()]);
        } elseif ($action === 'tag' || $action === 'untag') {
            $body['tags'] = ['prensa'];
            if ($action === 'untag') {
                $tag = Tag::create(['workspace_id' => $workspace->id, 'name' => 'prensa']);
                foreach ($ids as $id) {
                    DB::table('link_tags')->insert(['link_id' => $id, 'tag_id' => $tag->id]);
                }
            }
        } elseif ($action === 'move') {
            $body['collectionId'] = DB::table('collections')->insertGetId(['workspace_id' => $workspace->id, 'name' => 'Campaign']);
        } elseif ($action === 'set-domain') {
            $domain = CustomDomain::create([
                'workspace_id' => $workspace->id, 'domain' => 'batch.example.test', 'verification_token' => 'fixture',
                'desired_state' => 'enabled', 'ownership_status' => 'verified', 'routing_status' => 'healthy',
                'tls_status' => 'ready', 'edge_eligible' => true, 'tls_ready_at' => now(),
                'verified_at' => now(), 'ownership_verified_at' => now(), 'routing_verified_at' => now(),
            ]);
            $body['domainId'] = $domain->id;
        }

        DB::enableQueryLog();
        DB::flushQueryLog();
        $response = $this->postJson('/api/v1/links/bulk', $body, ['Idempotency-Key' => 'batch-'.$action])->assertOk()
            ->assertExactJson(['ok' => true, 'action' => $action, 'applied' => 3]);
        $queries = array_column(DB::getQueryLog(), 'query');
        $this->assertCount(1, array_filter($queries, fn ($sql) => str_contains($sql, 'pg_advisory_xact_lock')));
        $this->assertCount(1, array_filter($queries, fn ($sql) => str_contains($sql, 'from "webhook_deliveries" as "d"')));
        $this->assertCount(1, array_filter($queries, fn ($sql) => str_starts_with($sql, 'select "id", "config_version", "events" from "webhooks"')));
        $deliveries = WebhookDelivery::orderBy('id')->get();
        $this->assertSame($ids, $deliveries->map(fn ($delivery) => $delivery->payload['data']['linkId'])->all());
        $this->assertSame(array_fill(0, 3, $webhook->id), $deliveries->pluck('webhook_id')->all());
        $this->assertSame(array_fill(0, 3, $action === 'trash' ? 'link.deleted' : 'link.updated'), $deliveries->pluck('event')->all());
        $this->assertCount(3, array_unique($deliveries->pluck('event_id')->all()));
        $this->assertSame([2, 2, 2], Link::withTrashed()->whereIn('id', $ids)->orderBy('id')->pluck('version')->all());
        Queue::assertPushed(WebhookDeliveryJob::class, 3);
        $snapshot = $deliveries->toArray();
        $this->postJson('/api/v1/links/bulk', $body, ['Idempotency-Key' => 'batch-'.$action])->assertOk()
            ->assertExactJson($response->json())->assertHeader('Idempotent-Replay', 'true');
        $this->assertSame($snapshot, WebhookDelivery::orderBy('id')->get()->toArray());
        Queue::assertPushed(WebhookDeliveryJob::class, 3);
    }

    public function test_tag_additions_use_the_actual_attachment_result_and_noops_never_admit_events(): void
    {
        [$owner, $workspace, $ids] = $this->fixture(3);
        $tag = Tag::create(['workspace_id' => $workspace->id, 'name' => 'prensa']);
        DB::table('link_tags')->insert(['link_id' => $ids[0], 'tag_id' => $tag->id]);
        $body = ['action' => 'tag', 'linkIds' => $ids, 'tags' => ['prensa', 'prensa']];
        DB::enableQueryLog();
        DB::flushQueryLog();
        $this->postJson('/api/v1/links/bulk', $body, ['Idempotency-Key' => 'batch-partial-tags'])->assertOk()->assertJsonPath('applied', 2);
        $queries = array_column(DB::getQueryLog(), 'query');
        $this->assertSame([], array_values(array_filter($queries, fn ($sql) => str_contains($sql, 'count(*)') && str_contains($sql, 'link_tags'))));
        $this->assertSame([1, 2, 2], Link::whereIn('id', $ids)->orderBy('id')->pluck('version')->all());
        $this->assertSame(array_slice($ids, 1), WebhookDelivery::orderBy('id')->get()->map(fn ($delivery) => $delivery->payload['data']['linkId'])->all());
        $this->assertSame(3, DB::table('link_tags')->count());
        Queue::assertPushed(WebhookDeliveryJob::class, 2);
        DB::flushQueryLog();
        $this->postJson('/api/v1/links/bulk', $body, ['Idempotency-Key' => 'batch-noop-tags'])->assertOk()->assertJsonPath('applied', 0);
        $queries = array_column(DB::getQueryLog(), 'query');
        $this->assertSame([], array_values(array_filter($queries, fn ($sql) => str_contains($sql, 'pg_advisory_xact_lock') || str_contains($sql, 'from "webhook_deliveries" as "d"'))));
        $this->assertSame([1, 2, 2], Link::whereIn('id', $ids)->orderBy('id')->pluck('version')->all());
        Queue::assertPushed(WebhookDeliveryJob::class, 2);
    }

    public function test_capacity_failure_rolls_back_links_audit_idempotency_and_deliveries_then_allows_retry(): void
    {
        [$owner, $workspace, $ids, $webhook] = $this->fixture(2);
        $rows = [];
        for ($i = 0; $i < 999; $i++) {
            $rows[] = ['webhook_id' => $webhook->id, 'config_version' => 1, 'event' => 'link.updated', 'event_id' => 'prior-'.$i, 'payload' => '{}', 'status' => 'pending', 'created_at' => now()];
        }
        DB::table('webhook_deliveries')->insert($rows);
        $body = ['action' => 'pause', 'linkIds' => $ids];
        $key = ['Idempotency-Key' => 'batch-overflow-retry'];
        $this->postJson('/api/v1/links/bulk', $body, $key)->assertStatus(503);
        $this->assertSame(['active', 'active'], Link::whereIn('id', $ids)->orderBy('id')->pluck('state')->all());
        $this->assertSame([1, 1], Link::whereIn('id', $ids)->orderBy('id')->pluck('version')->all());
        $this->assertSame(999, WebhookDelivery::count());
        $this->assertSame(0, DB::table('audit_events')->where('action', 'link.bulk')->count());
        $this->assertSame(0, DB::table('idempotency_keys')->where('key', 'batch-overflow-retry')->count());
        Queue::assertNothingPushed();
        WebhookDelivery::where('event_id', 'prior-0')->update(['status' => 'success']);
        $this->postJson('/api/v1/links/bulk', $body, $key)->assertOk()->assertJsonPath('applied', 2);
        $this->assertSame(1000, WebhookDelivery::whereIn('status', ['pending', 'processing'])->count());
        $this->assertSame([2, 2], Link::whereIn('id', $ids)->orderBy('id')->pluck('version')->all());
        $this->assertSame(1, DB::table('audit_events')->where('action', 'link.bulk')->count());
        Queue::assertPushed(WebhookDeliveryJob::class, 2);
    }

    /** @return array{User, Workspace, list<int>, Webhook} */
    private function fixture(int $count): array
    {
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Batch', 'slug' => 'batch']);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);
        $ids = [];
        for ($i = 0; $i < $count; $i++) {
            $ids[] = Link::insertGetId(['workspace_id' => $workspace->id, 'created_by' => $owner->id, 'alias' => 'batch-'.$i, 'destination' => 'https://example.org/'.$i, 'state' => 'active', 'version' => 1, 'created_at' => now(), 'updated_at' => now()]);
        }
        $webhook = Webhook::create(['workspace_id' => $workspace->id, 'created_by' => $owner->id, 'url' => 'https://receiver.example.test/hook', 'secret' => UvhCrypto::encryptAtRest('fixture-only-secret'), 'events' => ['link.updated', 'link.deleted'], 'active' => true, 'config_version' => 1]);
        $this->withCookie('uvh_session', SessionManager::create($owner->id, Request::create('/'), (int) $owner->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $workspace->id);

        return [$owner, $workspace, $ids, $webhook];
    }
}
