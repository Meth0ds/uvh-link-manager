<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class AbuseReportTest extends TestCase
{
    private const CSRF = 'abuse-report-csrf';

    private int $workspaceId;

    private int $userId;

    protected function setUp(): void
    {
        parent::setUp();
        config(['uvh.public_host' => 'uvh.es']);
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, invitations, quotas, custom_domains, links, tags, link_tags, redirect_rules, click_events, metric_rollups, metric_unique_visitors, api_tokens, webhooks, webhook_deliveries, abuse_reports, audit_events, email_tokens, jobs, failed_jobs RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', self::CSRF)->withHeaders(['X-CSRF-Token' => self::CSRF]);

        $this->userId = User::factory()->create()->id;
        $this->workspaceId = DB::table('workspaces')->insertGetId([
            'name' => 'Abuse QA',
            'slug' => 'abuse-qa',
            'owner_user_id' => $this->userId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_report_accepts_default_domain_and_legacy_r_path(): void
    {
        $linkId = $this->createLink('default-report');

        $this->postJson('/api/v1/report', [
            'reportedUrl' => 'https://uvh.es/r/default-report?campaign=mail',
            'reason' => 'Phishing o suplantación de identidad',
            'captchaToken' => 'test-captcha-token',
        ])->assertCreated()->assertExactJson(['ok' => true]);

        $this->assertDatabaseHas('abuse_reports', ['link_id' => $linkId, 'status' => 'open']);
    }

    public function test_report_resolves_a_custom_domain_without_requesting_it(): void
    {
        $domainId = DB::table('custom_domains')->insertGetId([
            'workspace_id' => $this->workspaceId,
            'domain' => 'go.example.test',
            'verification_token' => 'uvh-verify=test',
            'state' => 'disabled',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $linkId = $this->createLink('incident-42', $domainId);

        $this->postJson('/api/v1/report', [
            'reportedUrl' => 'go.example.test/incident-42',
            'reason' => 'Malware o software malicioso',
            'email' => 'reporter@example.test',
            'captchaToken' => 'test-captcha-token',
        ])->assertCreated();

        $this->assertDatabaseHas('abuse_reports', [
            'link_id' => $linkId,
            'reporter_email' => 'reporter@example.test',
        ]);
    }

    public function test_report_rejects_ambiguous_or_credential_bearing_references(): void
    {
        $this->postJson('/api/v1/report', [
            'reportedUrl' => 'https://uvh.es/path/with/too-many-segments',
            'reason' => 'Otro',
            'captchaToken' => 'test-captcha-token',
        ])->assertStatus(422)->assertJson(['error' => 'Referencia de enlace inválida']);

        $this->postJson('/api/v1/report', [
            'reportedUrl' => 'https://user:secret@uvh.es/alias',
            'reason' => 'Otro',
            'captchaToken' => 'test-captcha-token',
        ])->assertStatus(422)->assertJson(['error' => 'Referencia de enlace inválida']);

        $this->assertDatabaseCount('abuse_reports', 0);
    }

    public function test_report_rejects_direct_internal_link_ids(): void
    {
        $linkId = $this->createLink('not-an-oracle');

        $this->postJson('/api/v1/report', [
            'linkId' => $linkId,
            'reason' => 'Otro',
            'captchaToken' => 'test-captcha-token',
        ])->assertStatus(422)->assertExactJson(['error' => 'Datos inválidos']);

        $this->assertDatabaseCount('abuse_reports', 0);
    }

    private function createLink(string $alias, ?int $domainId = null): int
    {
        return DB::table('links')->insertGetId([
            'workspace_id' => $this->workspaceId,
            'created_by' => $this->userId,
            'domain_id' => $domainId,
            'alias' => $alias,
            'destination' => 'https://destination.example.test',
            'state' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
