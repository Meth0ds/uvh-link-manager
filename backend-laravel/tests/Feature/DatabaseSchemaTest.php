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
            'invitation_mail_budgets',
            'quotas',
            'custom_domains',
            'links',
            'tags',
            'link_tags',
            'redirect_rules',
            'click_events',
            'metric_rollups',
            'metric_unique_visitors',
            'api_tokens',
            'webhooks',
            'webhook_deliveries',
            'abuse_reports',
            'audit_events',
            'email_tokens',
            'email_change_requests',
            'data_export_requests',
            'account_deletion_requests',
            'link_intent_claims',
            'mail_outbox',
            'account_recovery_requests',
            'account_recovery_approvals',
            'operational_metrics',
            'privacy_rights_requests',
            'privacy_rights_messages',
            'legal_acceptances',
        ];

        foreach ($tables as $table) {
            $this->assertTrue(Schema::hasTable($table), "Missing table: {$table}");
        }
    }

    #[Test]
    public function it_creates_the_critical_columns(): void
    {
        $expect = [
            'users' => ['id', 'email', 'name', 'password_hash', 'email_verified_at', 'is_admin', 'mfa_enabled', 'mfa_secret', 'mfa_pending_secret', 'mfa_pending_expires_at', 'recovery_codes', 'security_version', 'deleted_at'],
            'sessions' => ['id', 'user_id', 'user_agent', 'ip_hash', 'expires_at', 'revoked_at', 'security_version', 'mfa_verified_at'],
            'workspaces' => ['id', 'name', 'slug', 'owner_user_id'],
            'memberships' => ['workspace_id', 'user_id', 'role'],
            'invitations' => ['workspace_id', 'email', 'role', 'token', 'status', 'expires_at'],
            'invitation_mail_budgets' => ['budget_key', 'used', 'expires_at_epoch'],
            'quotas' => ['workspace_id', 'links_limit'],
            'custom_domains' => ['workspace_id', 'domain', 'verification_token', 'state', 'verified_at'],
            'links' => ['workspace_id', 'created_by', 'domain_id', 'alias', 'destination', 'state', 'state_before_delete', 'password_hash', 'password_version', 'version', 'max_clicks', 'click_count', 'single_use', 'expires_at', 'deleted_at'],
            'tags' => ['workspace_id', 'name'],
            'link_tags' => ['link_id', 'tag_id'],
            'redirect_rules' => ['link_id', 'priority', 'destination'],
            'click_events' => ['link_id', 'occurred_at', 'visitor_hash', 'password_ok'],
            'metric_rollups' => ['link_id', 'day', 'clicks', 'visitors', 'countries'],
            'metric_unique_visitors' => ['link_id', 'day', 'visitor_hash'],
            'api_tokens' => ['workspace_id', 'name', 'token_hash', 'scopes', 'revoked_at', 'expires_at', 'created_by'],
            'webhooks' => ['workspace_id', 'created_by', 'url', 'secret', 'events', 'active', 'config_version'],
            'webhook_deliveries' => ['webhook_id', 'config_version', 'event', 'event_id', 'payload', 'status', 'attempts', 'locked_at', 'next_attempt_at'],
            'abuse_reports' => ['link_id', 'reason', 'status', 'reporter_hash', 'report_day'],
            'audit_events' => ['user_id', 'workspace_id', 'action', 'resource_type', 'resource_id', 'metadata'],
            'email_tokens' => ['id', 'user_id', 'kind', 'expires_at', 'used_at'],
            // The primary string ID is itself the one-way bearer digest. Rows
            // are deleted on completion/cancellation rather than tombstoned.
            'email_change_requests' => ['id', 'user_id', 'new_email', 'security_version', 'expires_at', 'created_at'],
            'data_export_requests' => ['id', 'user_id', 'security_version', 'status', 'confirmation_token_hash', 'download_token_hash', 'artifact_path', 'download_served_at'],
            'account_deletion_requests' => ['id', 'user_id', 'security_version', 'status', 'confirmation_token_hash', 'cancel_token_hash', 'execute_after'],
            'link_intent_claims' => ['intent_hash', 'user_id', 'expires_at'],
            'mail_outbox' => ['id', 'idempotency_key', 'encrypted_envelope', 'kind', 'resource_type', 'resource_id', 'resource_generation', 'status', 'attempts', 'manual_retry_count', 'available_at', 'queued_at', 'locked_at', 'lock_token', 'sent_at', 'failed_at', 'last_manual_retry_at', 'last_error'],
            'account_recovery_requests' => ['id', 'user_id', 'security_version', 'status', 'confirmation_token_hash', 'confirmation_expires_at', 'completion_token_hash', 'completion_expires_at', 'expires_at'],
            'account_recovery_approvals' => ['id', 'request_id', 'admin_user_id', 'reason_code', 'created_at'],
            'operational_metrics' => ['id', 'metric', 'bucket_at', 'count'],
            'privacy_rights_requests' => ['id', 'user_id', 'security_version', 'type', 'status', 'generation_hash', 'assigned_admin_id', 'identity_verified_at', 'due_at', 'extended_until', 'completed_at'],
            'privacy_rights_messages' => ['id', 'request_id', 'author_role', 'author_user_id', 'encrypted_body', 'created_at'],
            'legal_acceptances' => ['id', 'user_id', 'document_type', 'version', 'source', 'accepted_at'],
        ];

        foreach ($expect as $table => $columns) {
            foreach ($columns as $column) {
                $this->assertTrue(Schema::hasColumn($table, $column), "Missing column {$table}.{$column}");
            }
        }
    }

    #[Test]
    public function it_creates_the_workspace_usage_indexes(): void
    {
        foreach ([
            'custom_domains' => 'workspace_usage_domains_idx',
            'api_tokens' => 'workspace_usage_tokens_idx',
            'webhooks' => 'workspace_usage_webhooks_idx',
        ] as $table => $index) {
            $this->assertTrue(Schema::hasIndex($table, $index), "Missing index: {$index}");
        }
    }
}
