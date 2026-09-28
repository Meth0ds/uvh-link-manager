<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The workspace's default domain: the one new links are preselected with and
 * the bulk "change domain" offers first. It is a preference, not routing
 * state — nothing serves from it — so it is a flag on the domain rather than
 * more status machinery.
 *
 * At most one default per workspace, enforced by a partial unique index so
 * every write path (including a future one) keeps the invariant. Deleting the
 * default domain simply removes the preference; no cross-table reference can
 * outlive the row it points at.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('custom_domains', function (Blueprint $table) {
            $table->boolean('is_default')->default(false);
        });
        DB::statement(
            'CREATE UNIQUE INDEX custom_domains_one_default_per_workspace_idx'
            .' ON custom_domains (workspace_id) WHERE is_default'
        );
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS custom_domains_one_default_per_workspace_idx');
        Schema::table('custom_domains', function (Blueprint $table) {
            $table->dropColumn('is_default');
        });
    }
};
