<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('audit_events', function (Blueprint $table) {
            // A tombstone identity, not a live-resource FK: deletion must not
            // erase attribution or make an after-commit delete event fail.
            // Old events stay NULL; actor membership is not tenant evidence.
            $table->bigInteger('workspace_id')->nullable();
            $table->index(['workspace_id', 'created_at', 'id'], 'audit_workspace_timeline_idx');
        });
        DB::statement('ALTER TABLE audit_events ADD CONSTRAINT audit_workspace_positive_check CHECK (workspace_id IS NULL OR workspace_id > 0)');
    }

    public function down(): void
    {
        // Dropping attribution loses history irreversibly. Retire dependent
        // readers/writers first; rollback requires an approved backup strategy.
        DB::statement('ALTER TABLE audit_events DROP CONSTRAINT audit_workspace_positive_check');
        Schema::table('audit_events', function (Blueprint $table) {
            $table->dropIndex('audit_workspace_timeline_idx');
            $table->dropColumn('workspace_id');
        });
    }
};
