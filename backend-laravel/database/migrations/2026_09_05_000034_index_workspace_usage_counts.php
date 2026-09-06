<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // PostgreSQL does not create indexes automatically for referencing FKs.
        // Without these, aggregate usage scans every tenant's rows as data grows.
        Schema::table('custom_domains', fn (Blueprint $table) => $table->index('workspace_id', 'workspace_usage_domains_idx'));
        Schema::table('api_tokens', fn (Blueprint $table) => $table->index(['workspace_id', 'revoked_at', 'expires_at'], 'workspace_usage_tokens_idx'));
        Schema::table('webhooks', fn (Blueprint $table) => $table->index('workspace_id', 'workspace_usage_webhooks_idx'));
    }

    public function down(): void
    {
        // Remove readers before rollback; otherwise usage may become an
        // unbounded cross-table scan even though its response remains correct.
        Schema::table('custom_domains', fn (Blueprint $table) => $table->dropIndex('workspace_usage_domains_idx'));
        Schema::table('api_tokens', fn (Blueprint $table) => $table->dropIndex('workspace_usage_tokens_idx'));
        Schema::table('webhooks', fn (Blueprint $table) => $table->dropIndex('workspace_usage_webhooks_idx'));
    }
};
