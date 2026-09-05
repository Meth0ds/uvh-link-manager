<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Ids;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class AdminConsoleTest extends TestCase
{
    private const CSRF = 'admin-console-csrf';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, invitations, quotas, custom_domains, links,
            tags, link_tags, redirect_rules, click_events, metric_rollups, metric_unique_visitors, api_tokens, webhooks,
            webhook_deliveries, abuse_reports, audit_events, email_tokens, mail_outbox, operational_metrics, jobs, failed_jobs RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', self::CSRF)->withHeaders(['X-CSRF-Token' => self::CSRF]);
    }

    public function test_admin_endpoints_require_mfa_on_the_current_session(): void
    {
        [$admin, $token] = $this->adminSession(false);

        $this->withCookie('uvh_session', $token)
            ->getJson('/api/v1/admin/overview')
            ->assertForbidden()
            ->assertJson(['error' => 'El área de administración requiere MFA activado en tu cuenta']);

        $this->assertTrue($admin->mfa_enabled);
    }

    public function test_users_are_filtered_and_paginated_without_exposing_credentials(): void
    {
        [, $token] = $this->adminSession();
        foreach (range(1, 27) as $index) {
            User::create([
                'email' => "member{$index}@example.test",
                'name' => "Member {$index}",
                'password_hash' => 'not-used-in-admin-test',
                'email_verified_at' => now(),
                'security_version' => 1,
            ]);
        }
        User::where('email', 'member27@example.test')->update(['deleted_at' => now()]);

        $response = $this->withCookie('uvh_session', $token)
            ->getJson('/api/v1/admin/users?status=active&page=2&perPage=10');

        $response->assertOk()->assertJsonStructure(['users', 'total', 'page', 'perPage']);
        $this->assertSame(27, $response->json('total'));
        $this->assertSame(2, $response->json('page'));
        $this->assertCount(10, $response->json('users'));
        $json = $response->getContent();
        $this->assertStringNotContainsString('password_hash', $json);
        $this->assertStringNotContainsString('mfa_secret', $json);

        $this->withCookie('uvh_session', $token)
            ->getJson('/api/v1/admin/users?status=not-a-state')
            ->assertUnprocessable()
            ->assertJson(['error' => 'Filtro de usuario inválido']);
    }

    public function test_blocking_an_account_revokes_every_access_and_pending_email_token(): void
    {
        [, $adminToken] = $this->adminSession();
        $target = $this->user('target@example.test');
        $targetToken = Ids::randomToken(32);
        DB::table('sessions')->insert([
            'id' => Ids::sha256Hex($targetToken),
            'user_id' => $target->id,
            'security_version' => 1,
            'created_at' => now(),
            'last_used_at' => now(),
            'expires_at' => now()->addDay(),
        ]);
        $workspaceId = $this->workspace($target->id, 'Target workspace');
        DB::table('api_tokens')->insert([
            'workspace_id' => $workspaceId,
            'name' => 'Target token',
            'token_hash' => hash('sha256', 'target-token'),
            'scopes' => json_encode(['links:read']),
            'created_by' => $target->id,
            'created_at' => now(),
        ]);
        DB::table('email_tokens')->insert([
            'id' => hash('sha256', 'pending-reset'),
            'user_id' => $target->id,
            'kind' => 'reset',
            'expires_at' => now()->addHour(),
            'created_at' => now(),
        ]);

        $this->withCookie('uvh_session', $adminToken)
            ->patchJson('/api/v1/admin/users/'.$target->id, ['blocked' => true])
            ->assertOk()
            ->assertExactJson(['ok' => true]);

        $this->assertNotNull(DB::table('users')->where('id', $target->id)->value('deleted_at'));
        $this->assertNotNull(DB::table('sessions')->where('user_id', $target->id)->value('revoked_at'));
        $this->assertNotNull(DB::table('api_tokens')->where('created_by', $target->id)->value('revoked_at'));
        $this->assertNotNull(DB::table('email_tokens')->where('user_id', $target->id)->value('used_at'));
        $this->withCookie('uvh_session', $targetToken)->getJson('/api/v1/auth/me')->assertUnauthorized();
    }

    public function test_the_last_active_administrator_cannot_be_demoted_or_blocked(): void
    {
        [$admin, $token] = $this->adminSession();

        $this->withCookie('uvh_session', $token)
            ->patchJson('/api/v1/admin/users/'.$admin->id, ['isAdmin' => false])
            ->assertForbidden();
        $this->withCookie('uvh_session', $token)
            ->patchJson('/api/v1/admin/users/'.$admin->id, ['blocked' => true])
            ->assertForbidden();

        $this->assertDatabaseHas('users', ['id' => $admin->id, 'is_admin' => true, 'deleted_at' => null]);
    }

    public function test_report_moderation_updates_report_link_and_audit_atomically(): void
    {
        [$admin, $token] = $this->adminSession();
        $owner = $this->user('owner@example.test');
        $workspaceId = $this->workspace($owner->id, 'Moderation');
        $linkId = DB::table('links')->insertGetId([
            'workspace_id' => $workspaceId,
            'created_by' => $owner->id,
            'alias' => 'reported-link',
            'destination' => 'https://example.test/reported',
            'state' => 'active',
            'expires_at' => now()->subMinute(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $reportId = DB::table('abuse_reports')->insertGetId([
            'link_id' => $linkId,
            'reporter_email' => 'reporter@example.test',
            'reason' => 'phishing',
            'status' => 'open',
            'created_at' => now(),
        ]);

        $this->withCookie('uvh_session', $token)
            ->postJson('/api/v1/admin/reports/'.$reportId.'/moderate', [
                'action' => 'block',
                'reason' => 'Contenido fraudulento confirmado',
            ])
            ->assertOk()
            ->assertJson(['linkState' => 'blocked', 'reportStatus' => 'actioned']);
        $this->assertDatabaseHas('links', ['id' => $linkId, 'state' => 'blocked']);
        $this->assertDatabaseHas('abuse_reports', ['id' => $reportId, 'status' => 'actioned']);
        $this->assertDatabaseHas('audit_events', [
            'user_id' => $admin->id,
            'action' => 'admin.report_moderate',
            'resource_id' => (string) $reportId,
        ]);

        $this->withCookie('uvh_session', $token)
            ->postJson('/api/v1/admin/reports/'.$reportId.'/moderate', ['action' => 'unblock'])
            ->assertOk()
            ->assertJson(['linkState' => 'expired', 'reportStatus' => 'actioned']);
        $this->assertDatabaseHas('links', ['id' => $linkId, 'state' => 'expired']);
    }

    public function test_admin_block_survives_soft_delete_until_explicitly_unblocked(): void
    {
        [, $adminToken] = $this->adminSession();
        $owner = $this->user('deleted-owner@example.test');
        $workspaceId = $this->workspace($owner->id, 'Deleted moderation');
        $linkId = DB::table('links')->insertGetId([
            'workspace_id' => $workspaceId,
            'created_by' => $owner->id,
            'alias' => 'deleted-reported-link',
            'destination' => 'https://example.test/deleted',
            'state' => 'deleted',
            'state_before_delete' => 'active',
            'deleted_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $reportId = DB::table('abuse_reports')->insertGetId([
            'link_id' => $linkId,
            'reason' => 'malware',
            'status' => 'open',
            'created_at' => now(),
        ]);

        $this->withCookie('uvh_session', $adminToken)
            ->postJson('/api/v1/admin/reports/'.$reportId.'/moderate', [
                'action' => 'block',
                'reason' => 'Contenido malicioso confirmado',
            ])
            ->assertOk()
            ->assertJsonPath('linkState', 'deleted');
        $this->assertDatabaseHas('links', [
            'id' => $linkId,
            'state' => 'deleted',
            'state_before_delete' => 'blocked',
        ]);

        $ownerToken = Ids::randomToken(32);
        DB::table('sessions')->insert([
            'id' => Ids::sha256Hex($ownerToken),
            'user_id' => $owner->id,
            'security_version' => 1,
            'created_at' => now(),
            'last_used_at' => now(),
            'expires_at' => now()->addDay(),
        ]);
        $this->withCookie('uvh_session', $ownerToken)
            ->withHeader('X-Workspace-Id', (string) $workspaceId)
            ->postJson('/api/v1/links/'.$linkId.'/restore')
            ->assertForbidden();

        $this->withCookie('uvh_session', $adminToken)
            ->postJson('/api/v1/admin/reports/'.$reportId.'/moderate', ['action' => 'unblock'])
            ->assertOk()
            ->assertJsonPath('linkState', 'deleted');
        $this->assertDatabaseHas('links', [
            'id' => $linkId,
            'state' => 'deleted',
            'state_before_delete' => 'active',
        ]);

        $this->withCookie('uvh_session', $ownerToken)
            ->withHeader('X-Workspace-Id', (string) $workspaceId)
            ->postJson('/api/v1/links/'.$linkId.'/restore')
            ->assertOk();
        $this->assertDatabaseHas('links', ['id' => $linkId, 'state' => 'active', 'deleted_at' => null]);
    }

    public function test_operations_exposes_actionable_counts_but_no_configuration_secrets(): void
    {
        $appSecret = 'test-app-secret-must-never-be-exposed';
        $captchaSecret = 'test-hcaptcha-secret-must-never-be-exposed';
        config([
            'uvh.secret' => $appSecret,
            'uvh.hcaptcha.secret' => $captchaSecret,
        ]);

        [, $token] = $this->adminSession();
        DB::table('failed_jobs')->insert([
            'uuid' => '00000000-0000-4000-8000-000000000099',
            'connection' => 'database',
            'queue' => 'default',
            'payload' => '{}',
            'exception' => 'fixture',
            'failed_at' => now(),
        ]);

        $response = $this->withCookie('uvh_session', $token)->getJson('/api/v1/admin/operations');
        $response->assertOk()->assertJsonStructure([
            'state', 'environment', 'generatedAt', 'checks',
            'metrics' => [
                'pendingJobs', 'oldestJobAgeSeconds', 'failedJobs',
                'webhookDeliveries', 'oldestPendingWebhookAgeSeconds',
                'mailOutbox', 'oldestPendingMailAgeSeconds',
                'activeSessions', 'unverifiedUsers', 'domains',
                'oldestDnsCheckAgeSeconds', 'oldestTlsProvisioningAgeSeconds',
                'events60m',
            ],
        ]);
        $this->assertSame(1, $response->json('metrics.failedJobs'));
        $events = $response->json('metrics.events60m');
        $this->assertIsArray($events);
        $this->assertArrayHasKey('http.too_many_requests', $events);
        $this->assertSame(0, $events['http.too_many_requests']);
        $this->assertStringNotContainsString($appSecret, $response->getContent());
        $this->assertStringNotContainsString($captchaSecret, $response->getContent());
    }

    /** @return array{User, string} */
    private function adminSession(bool $mfaVerified = true): array
    {
        $admin = User::create([
            'email' => 'admin'.Ids::randomToken(4).'@example.test',
            'name' => 'Platform Admin',
            'password_hash' => 'not-used-in-admin-test',
            'email_verified_at' => now(),
            'is_admin' => true,
            'mfa_enabled' => true,
            'security_version' => 1,
        ]);
        $token = Ids::randomToken(32);
        DB::table('sessions')->insert([
            'id' => Ids::sha256Hex($token),
            'user_id' => $admin->id,
            'security_version' => 1,
            'mfa_verified_at' => $mfaVerified ? now() : null,
            'created_at' => now(),
            'last_used_at' => now(),
            'expires_at' => now()->addDay(),
        ]);

        return [$admin, $token];
    }

    private function user(string $email): User
    {
        return User::create([
            'email' => $email,
            'name' => 'Test User',
            'password_hash' => 'not-used-in-admin-test',
            'email_verified_at' => now(),
            'security_version' => 1,
        ]);
    }

    private function workspace(int $ownerId, string $name): int
    {
        $id = DB::table('workspaces')->insertGetId([
            'name' => $name,
            'slug' => strtolower(str_replace(' ', '-', $name)).'-'.Ids::randomToken(4),
            'owner_user_id' => $ownerId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('memberships')->insert([
            'workspace_id' => $id,
            'user_id' => $ownerId,
            'role' => 'owner',
            'created_at' => now(),
        ]);

        return $id;
    }
}
