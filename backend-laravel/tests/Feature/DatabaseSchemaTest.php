<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class DatabaseSchemaTest extends TestCase
{
    #[Test]
    public function it_creates_all_uvh_tables(): void
    {
        $tables = [
            'users',
            'sessions',
            'workspaces',
            'memberships',
            'invitations',
            'quotas',
            'custom_domains',
            'links',
            'tags',
            'link_tags',
            'redirect_rules',
            'click_events',
            'metric_rollups',
            'api_tokens',
            'webhooks',
            'webhook_deliveries',
            'abuse_reports',
            'audit_events',
            'email_tokens',
        ];

        foreach ($tables as $table) {
            $this->assertTrue(Schema::hasTable($table), "Missing table: {$table}");
        }
    }

    #[Test]
    public function it_creates_the_critical_columns(): void
    {
        $expect = [
            'users' => ['id', 'email', 'name', 'password_hash', 'email_verified_at', 'is_admin', 'mfa_enabled', 'mfa_secret', 'recovery_codes', 'deleted_at'],
            'sessions' => ['id', 'user_id', 'user_agent', 'ip_hash', 'expires_at', 'revoked_at'],
            'workspaces' => ['id', 'name', 'slug', 'owner_user_id'],
            'memberships' => ['workspace_id', 'user_id', 'role'],
            'invitations' => ['workspace_id', 'email', 'role', 'token', 'status', 'expires_at'],
            'quotas' => ['workspace_id', 'links_limit'],
            'custom_domains' => ['workspace_id', 'domain', 'verification_token', 'state', 'verified_at'],
            'links' => ['workspace_id', 'created_by', 'domain_id', 'alias', 'destination', 'state', 'password_hash', 'max_clicks', 'click_count', 'single_use', 'expires_at', 'deleted_at'],
            'tags' => ['workspace_id', 'name'],
            'link_tags' => ['link_id', 'tag_id'],
            'redirect_rules' => ['link_id', 'priority', 'destination'],
            'click_events' => ['link_id', 'occurred_at', 'visitor_hash', 'password_ok'],
            'metric_rollups' => ['link_id', 'day', 'clicks', 'visitors', 'countries'],
            'api_tokens' => ['workspace_id', 'name', 'token_hash', 'scopes', 'revoked_at', 'expires_at', 'created_by'],
            'webhooks' => ['workspace_id', 'url', 'secret', 'events', 'active'],
            'webhook_deliveries' => ['webhook_id', 'event', 'event_id', 'payload', 'status', 'attempts', 'next_attempt_at'],
            'abuse_reports' => ['link_id', 'reason', 'status'],
            'audit_events' => ['user_id', 'action', 'resource_type', 'resource_id', 'metadata'],
            'email_tokens' => ['id', 'user_id', 'kind', 'expires_at', 'used_at'],
        ];

        foreach ($expect as $table => $columns) {
            foreach ($columns as $column) {
                $this->assertTrue(Schema::hasColumn($table, $column), "Missing column {$table}.{$column}");
            }
        }
    }
}
