<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class WebhookAuditAtomicityTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'webhook-audit-csrf')->withHeader('X-CSRF-Token', 'webhook-audit-csrf');
        Queue::fake();
    }

    public static function mutations(): array
    {
        return [['update'], ['delete'], ['resend']];
    }

    #[DataProvider('mutations')]
    public function test_audit_admission_failure_rolls_back_the_webhook_mutation(string $mutation): void
    {
        [$hook, $delivery] = $this->fixture();
        Schema::rename('audit_outbox', 'audit_outbox_unavailable');
        try {
            $this->mutate($mutation, $hook, $delivery)->assertServerError();
        } finally {
            Schema::rename('audit_outbox_unavailable', 'audit_outbox');
        }
        $this->assertNotNull($hook->fresh());
        $this->assertTrue($hook->fresh()->active);
        $this->assertSame(1, (int) $hook->fresh()->config_version);
        $this->assertSame('failed', $delivery->fresh()->status);
        $this->assertSame(5, (int) $delivery->fresh()->attempts);
        $this->assertSame(0, DB::table('audit_outbox')->count());
        Queue::assertNothingPushed();
    }

    #[DataProvider('mutations')]
    public function test_committed_mutation_preserves_exact_audit_when_history_is_unavailable(string $mutation): void
    {
        [$hook, $delivery] = $this->fixture();
        Schema::rename('audit_events', 'audit_events_unavailable');
        try {
            $this->mutate($mutation, $hook, $delivery)->assertOk();
            $this->assertSame(1, DB::table('audit_outbox')->count());
            $event = json_decode(DB::table('audit_outbox')->value('event'), true, flags: JSON_THROW_ON_ERROR);
            $this->assertSame('webhook.'.$mutation, $event['action']);
            $this->assertSame((string) $hook->id, $event['resource_id']);
            $this->assertSame($hook->workspace_id, $event['workspace_id']);
        } finally {
            Schema::rename('audit_events_unavailable', 'audit_events');
        }
        $this->assertTrue(Audit::drain());
        $this->assertTrue(Audit::drain());
        $this->assertSame(1, DB::table('audit_events')->where('action', 'webhook.'.$mutation)->count());
        $this->assertSame(0, DB::table('audit_outbox')->count());
    }

    private function fixture(): array
    {
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Audit', 'slug' => Ids::randomToken(12)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $hook = Webhook::create(['workspace_id' => $workspace->id, 'created_by' => $owner->id,
            'url' => 'https://hooks.example.test/audit', 'secret' => UvhCrypto::encryptAtRest('audit-fixture-secret'),
            'events' => ['link.updated'], 'active' => true, 'config_version' => 1]);
        $delivery = WebhookDelivery::create(['webhook_id' => $hook->id, 'config_version' => 1,
            'event' => 'link.updated', 'event_id' => Ids::randomToken(12), 'payload' => [],
            'status' => 'failed', 'attempts' => 5, 'last_error' => 'HTTP 503']);
        $this->withCookie('uvh_session', SessionManager::create($owner->id, Request::create('/'), (int) $owner->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $workspace->id);

        return [$hook, $delivery];
    }

    private function mutate(string $mutation, Webhook $hook, WebhookDelivery $delivery): TestResponse
    {
        return match ($mutation) {
            'update' => $this->patchJson('/api/v1/webhooks/'.$hook->id, ['active' => false]),
            'delete' => $this->deleteJson('/api/v1/webhooks/'.$hook->id),
            'resend' => $this->postJson('/api/v1/webhooks/'.$hook->id.'/deliveries/'.$delivery->id.'/resend'),
        };
    }
}
