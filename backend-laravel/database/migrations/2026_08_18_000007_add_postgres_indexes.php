<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // Case-insensitive uniqueness (SQLite COLLATE NOCASE equivalent).
        DB::statement('CREATE UNIQUE INDEX users_email_unique ON users (lower(email))');
        DB::statement('CREATE UNIQUE INDEX invitations_workspace_email_unique ON invitations (workspace_id, lower(email))');
        DB::statement('CREATE UNIQUE INDEX custom_domains_domain_unique ON custom_domains (lower(domain))');
        DB::statement('CREATE UNIQUE INDEX links_domain_alias_unique ON links (domain_id, lower(alias))');
        DB::statement('CREATE UNIQUE INDEX links_default_alias_unique ON links (lower(alias)) WHERE domain_id IS NULL');
        DB::statement('CREATE UNIQUE INDEX tags_workspace_name_unique ON tags (workspace_id, lower(name))');

        // Foreign-key / hot-path indexes (SQLite index parity).
        DB::statement('CREATE INDEX idx_sessions_user ON sessions (user_id)');
        DB::statement('CREATE INDEX idx_memberships_user ON memberships (user_id)');
        DB::statement('CREATE INDEX idx_links_workspace ON links (workspace_id)');
        DB::statement('CREATE INDEX idx_links_alias ON links (alias)');
        DB::statement('CREATE INDEX idx_rules_link ON redirect_rules (link_id)');
        DB::statement('CREATE INDEX idx_click_link_time ON click_events (link_id, occurred_at)');
        DB::statement('CREATE INDEX idx_deliveries_webhook ON webhook_deliveries (webhook_id)');
        DB::statement('CREATE INDEX idx_audit_time ON audit_events (created_at)');
        DB::statement('CREATE INDEX idx_email_tokens_user ON email_tokens (user_id)');

        // Housekeeping purge indexes.
        DB::statement('CREATE INDEX idx_sessions_expires ON sessions (expires_at)');
        DB::statement('CREATE INDEX idx_sessions_revoked ON sessions (revoked_at) WHERE revoked_at IS NOT NULL');
        DB::statement('CREATE INDEX idx_email_tokens_created ON email_tokens (created_at)');
        DB::statement('CREATE INDEX idx_click_time ON click_events (occurred_at)');
        DB::statement("CREATE INDEX idx_deliveries_success_delivered ON webhook_deliveries (delivered_at) WHERE status = 'success'");
    }

    public function down(): void
    {
        $indexes = [
            'idx_deliveries_success_delivered',
            'idx_click_time',
            'idx_email_tokens_created',
            'idx_sessions_revoked',
            'idx_sessions_expires',
            'idx_email_tokens_user',
            'idx_audit_time',
            'idx_deliveries_webhook',
            'idx_click_link_time',
            'idx_rules_link',
            'idx_links_alias',
            'idx_links_workspace',
            'idx_memberships_user',
            'idx_sessions_user',
            'tags_workspace_name_unique',
            'links_default_alias_unique',
            'links_domain_alias_unique',
            'custom_domains_domain_unique',
            'invitations_workspace_email_unique',
            'users_email_unique',
        ];
        foreach ($indexes as $index) {
            DB::statement("DROP INDEX IF EXISTS {$index}");
        }
    }
};
