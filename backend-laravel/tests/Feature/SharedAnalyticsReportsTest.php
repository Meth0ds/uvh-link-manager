<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Workspace;
use App\Support\AnalyticsService;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

final class SharedAnalyticsReportsTest extends TestCase
{
    private User $owner;

    private Workspace $workspace;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, audit_events RESTART IDENTITY CASCADE');
        Queue::fake();
        config(['sharing.reports' => true]);
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'report-csrf')->withHeader('X-CSRF-Token', 'report-csrf');
        $this->owner = User::factory()->create(['email_verified_at' => now()]);
        $this->workspace = $this->owner->ownedWorkspaces()->create(['name' => 'Reports', 'slug' => Ids::randomToken(12)]);
        $this->workspace->memberships()->create(['user_id' => $this->owner->id, 'role' => 'owner']);
        $this->withCookie((string) config('uvh.session_cookie'), SessionManager::create($this->owner->id, Request::create('/'), (int) $this->owner->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $this->workspace->id);
    }

    private function link(): int
    {
        return $this->withHeader('Idempotency-Key', Ids::randomToken(16))->postJson('/api/v1/links', ['destination' => 'https://example.org/private?secret=hidden', 'notes' => 'private notes'])->assertCreated()->json('link.id');
    }

    private function payload(int $link): array
    {
        return ['spec' => ['version' => 1, 'title' => 'Informe cliente', 'period' => '30d'], 'links' => [['linkId' => $link, 'label' => 'Campaña pública']]];
    }

    private function report(array $payload): array
    {
        return $this->withHeader('Idempotency-Key', Ids::randomToken(16))->postJson('/api/v1/analytics-reports', $payload)->assertCreated()->json('report');
    }

    private function open(array $report, ?string $password = null): void
    {
        $token = explode('#token=', $report['shareUrl'])[1];
        $response = $this->postJson('/api/v1/shared-reports/'.$report['publicId'].'/access', ['token' => $token, 'password' => $password])->assertOk();
        $name = 'uvh_report_'.str_replace('-', '', $report['publicId']);
        $cookie = $response->getCookie($name, false);
        self::assertNotNull($cookie);
        self::assertSame('/api/v1/shared-reports/'.$report['publicId'], $cookie->getPath());
        self::assertTrue($cookie->isHttpOnly());
        $this->withCookie($name, $cookie->getValue());
    }

    public function test_hundred_link_report_has_bounded_queries_and_exact_totals(): void
    {
        $items = [];
        for ($n = 0; $n < 100; $n++) {
            $id = DB::table('links')->insertGetId(['workspace_id' => $this->workspace->id, 'created_by' => $this->owner->id, 'alias' => 'report-batch-'.$n, 'destination' => 'https://example.org', 'state' => 'active']);
            $items[] = ['linkId' => $id, 'label' => 'Canal '.$n];
        }
        // A sizeable event population exercises the real aggregate queries;
        // direct insertion keeps setup independent of rollup implementation.
        DB::statement("INSERT INTO click_events (event_id, link_id, occurred_at, country, device, password_ok) SELECT gen_random_uuid(), l.id, now() - (g.n % 28) * interval '1 day', 'ES', 'mobile', true FROM links l CROSS JOIN generate_series(1, 500) AS g(n) WHERE l.workspace_id = ?", [$this->workspace->id]);
        $report = $this->report(['spec' => ['version' => 1, 'title' => 'Cien enlaces'], 'links' => $items]);
        $this->open($report);
        DB::enableQueryLog();
        DB::flushQueryLog();
        try {
            $this->getJson('/api/v1/shared-reports/'.$report['publicId'].'/overview')->assertOk()->assertJsonPath('visits', 50000)->assertJsonPath('countries.0.value', 50000)->assertJsonPath('devices.0.value', 50000);
            self::assertLessThan(35, count(DB::getQueryLog()));
        } finally {
            DB::disableQueryLog();
        }
    }

    public function test_public_access_rejects_other_origins_tokens_and_csrf(): void
    {
        $report = $this->report($this->payload($this->link()));
        $path = '/api/v1/shared-reports/'.$report['publicId'].'/access';
        $token = explode('#token=', $report['shareUrl'])[1];
        $this->withHeader('Origin', 'https://attacker.example')->postJson($path, ['token' => $token])->assertForbidden();
        $this->withHeader('Origin', rtrim((string) config('uvh.frontend_url'), '/'))->postJson($path, ['token' => str_repeat('a', 43)])->assertNotFound();
        $this->withHeader('X-CSRF-Token', 'wrong')->postJson($path, ['token' => $token])->assertForbidden();
    }

    public function test_retention_does_not_publish_stale_events_when_purging_is_delayed(): void
    {
        config(['uvh.housekeeping.analytics_retention_days' => 7]);
        $link = $this->link();
        AnalyticsService::recordClick($link, ['country' => 'ES'], occurredAt: now()->subDays(12)->toIso8601String());
        $payload = $this->payload($link);
        $payload['spec'] += ['period' => 'custom'];
        $payload['spec']['period'] = 'custom';
        $payload['spec']['from'] = now()->subDays(14)->toDateString();
        $payload['spec']['to'] = now()->subDays(10)->toDateString();
        $report = $this->report($payload);
        $this->open($report);
        $this->getJson('/api/v1/shared-reports/'.$report['publicId'].'/overview')->assertOk()->assertJsonPath('visits', null)->assertJsonPath('countries', [])->assertJsonPath('series.0.available', false);
    }

    public function test_public_projection_is_explicit_and_does_not_expand_selection(): void
    {
        $link = $this->link();
        $report = $this->report($this->payload($link));
        AnalyticsService::recordClick($link, ['country' => 'ES', 'device' => 'mobile', 'campaign' => 'confidential-campaign', 'referrer_domain' => 'internal.example']);
        AnalyticsService::recordClick($this->link(), ['country' => 'US']);
        $this->open($report);
        $r = $this->getJson('/api/v1/shared-reports/'.$report['publicId'].'/overview')->assertOk()->assertJsonPath('visits', 1)->assertJsonPath('labels.0', 'Campaña pública');
        foreach (['hidden', 'private notes', 'confidential-campaign', 'internal.example', 'visitor_hash', 'workspace_id', 'destination'] as $secret) {
            self::assertStringNotContainsString($secret, $r->getContent());
        }
    }

    public function test_password_and_rotation_revoke_existing_cookie_and_old_url(): void
    {
        $report = $this->report($this->payload($this->link()) + ['password' => 'Flores-en-la-ventana!']);
        $token = explode('#token=', $report['shareUrl'])[1];
        $path = '/api/v1/shared-reports/'.$report['publicId'];
        $this->postJson($path.'/access', ['token' => $token])->assertJsonPath('passwordRequired', true);
        $this->postJson($path.'/access', ['token' => $token, 'password' => 'wrong'])->assertStatus(422);
        $this->open($report, 'Flores-en-la-ventana!');
        $this->getJson($path.'/overview')->assertOk();
        $this->withHeader('Idempotency-Key', Ids::randomToken(16))->postJson('/api/v1/analytics-reports/'.$report['id'].'/rotate-access', ['version' => 1])->assertOk();
        $this->getJson($path.'/overview')->assertUnauthorized();
        $this->postJson($path.'/access', ['token' => $token])->assertNotFound();
    }

    public function test_revocation_expiry_and_deleted_references_fail_closed(): void
    {
        $link = $this->link();
        $report = $this->report($this->payload($link));
        $this->open($report);
        DB::table('links')->where('id', $link)->update(['deleted_at' => now()]);
        $this->getJson('/api/v1/shared-reports/'.$report['publicId'].'/overview')->assertNotFound();
        DB::table('links')->where('id', $link)->update(['deleted_at' => null]);
        DB::table('analytics_reports')->where('id', $report['id'])->update(['expires_at' => now()->subMinute()]);
        $this->getJson('/api/v1/shared-reports/'.$report['publicId'].'/overview')->assertNotFound();
        DB::table('analytics_reports')->where('id', $report['id'])->update(['expires_at' => null]);
        $this->withHeader('Idempotency-Key', Ids::randomToken(16))->postJson('/api/v1/analytics-reports/'.$report['id'].'/revoke', ['version' => 1])->assertOk();
        $this->getJson('/api/v1/shared-reports/'.$report['publicId'].'/overview')->assertNotFound();
    }

    public function test_idempotency_receipt_is_encrypted_and_mismatch_does_not_create(): void
    {
        $payload = $this->payload($this->link());
        $this->withHeader('Idempotency-Key', 'shared-report-create-key');
        $first = $this->postJson('/api/v1/analytics-reports', $payload)->assertCreated()->json();
        $this->postJson('/api/v1/analytics-reports', $payload)->assertCreated()->assertExactJson($first);
        $this->postJson('/api/v1/analytics-reports', array_replace($payload, ['expiresAt' => null]))->assertConflict();
        self::assertSame(1, DB::table('analytics_reports')->count());
        $receipt = DB::table('idempotency_keys')->where('key', 'shared-report-create-key')->value('response_body');
        self::assertStringNotContainsString(explode('#token=', $first['report']['shareUrl'])[1], $receipt);
    }

    public function test_existing_foreign_workspace_links_and_reports_are_isolated(): void
    {
        $other = $this->owner->ownedWorkspaces()->create(['name' => 'Otro', 'slug' => Ids::randomToken(12)]);
        $other->memberships()->create(['user_id' => $this->owner->id, 'role' => 'owner']);
        $foreign = DB::table('links')->insertGetId(['workspace_id' => $other->id, 'created_by' => $this->owner->id, 'alias' => 'foreign', 'destination' => 'https://example.org', 'state' => 'active']);
        $payload = $this->payload($foreign);
        $this->withHeader('Idempotency-Key', 'tenant-report-key')->postJson('/api/v1/analytics-reports', $payload)->assertUnprocessable();
        $this->withHeader('X-Workspace-Id', (string) $other->id);
        $foreignReport = $this->postJson('/api/v1/analytics-reports', $payload)->assertCreated()->json('report');
        $this->withHeader('X-Workspace-Id', (string) $this->workspace->id);
        $this->getJson('/api/v1/analytics-reports/'.$foreignReport['id'])->assertNotFound();
        $this->postJson('/api/v1/analytics-reports', $this->payload($this->link()) + ['secret_digest' => 'spoof'])->assertUnprocessable();
    }

    public function test_admin_role_is_rechecked_and_references_are_isolated(): void
    {
        $payload = $this->payload($this->link());
        $this->workspace->memberships()->where('user_id', $this->owner->id)->update(['role' => 'editor']);
        $this->withHeader('Idempotency-Key', Ids::randomToken(16))->postJson('/api/v1/analytics-reports', $payload)->assertForbidden();
        $this->workspace->memberships()->where('user_id', $this->owner->id)->update(['role' => 'owner']);
        $payload['links'][0]['linkId'] = 999999;
        $this->postJson('/api/v1/analytics-reports', $payload)->assertUnprocessable();
    }

    public function test_config_change_invalidates_cookie_and_enforces_version(): void
    {
        $payload = $this->payload($this->link());
        $report = $this->report($payload);
        $this->open($report);
        $payload['version'] = 1;
        $payload['spec']['sections'] = ['visits'];
        $this->withHeader('Idempotency-Key', Ids::randomToken(16))->patchJson('/api/v1/analytics-reports/'.$report['id'], $payload)->assertOk();
        $this->getJson('/api/v1/shared-reports/'.$report['publicId'].'/overview')->assertUnauthorized();
        $this->withHeader('Idempotency-Key', Ids::randomToken(16))->patchJson('/api/v1/analytics-reports/'.$report['id'], $payload)->assertConflict();
        $this->open($report);
        $this->getJson('/api/v1/shared-reports/'.$report['publicId'].'/overview')->assertOk()->assertJsonPath('series', [])->assertJsonPath('countries', []);
    }
}
