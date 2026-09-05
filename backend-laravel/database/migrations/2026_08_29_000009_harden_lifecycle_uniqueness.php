<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('links', function (Blueprint $table) {
            $table->string('state_before_delete')->nullable()->after('state');
        });

        // Historical invitations and soft-deleted links must not permanently
        // occupy a usable email/alias. The active-state predicates preserve the
        // public namespace while permitting the intended lifecycle operations.
        DB::statement('DROP INDEX IF EXISTS invitations_workspace_email_unique');
        DB::statement('DROP INDEX IF EXISTS links_domain_alias_unique');
        DB::statement('DROP INDEX IF EXISTS links_default_alias_unique');
        DB::statement("CREATE UNIQUE INDEX invitations_workspace_pending_email_unique ON invitations (workspace_id, lower(email)) WHERE status = 'pending'");
        DB::statement('CREATE UNIQUE INDEX links_domain_alias_live_unique ON links (domain_id, lower(alias)) WHERE domain_id IS NOT NULL AND deleted_at IS NULL');
        DB::statement('CREATE UNIQUE INDEX links_default_alias_live_unique ON links (lower(alias)) WHERE domain_id IS NULL AND deleted_at IS NULL');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS invitations_workspace_pending_email_unique');
        DB::statement('DROP INDEX IF EXISTS links_domain_alias_live_unique');
        DB::statement('DROP INDEX IF EXISTS links_default_alias_live_unique');
        DB::statement('CREATE UNIQUE INDEX invitations_workspace_email_unique ON invitations (workspace_id, lower(email))');
        DB::statement('CREATE UNIQUE INDEX links_domain_alias_unique ON links (domain_id, lower(alias))');
        DB::statement('CREATE UNIQUE INDEX links_default_alias_unique ON links (lower(alias)) WHERE domain_id IS NULL');

        Schema::table('links', function (Blueprint $table) {
            $table->dropColumn('state_before_delete');
        });
    }
};
