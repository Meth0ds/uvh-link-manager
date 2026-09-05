<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('webhooks', function (Blueprint $table) {
            $table->foreignId('created_by')->nullable()->after('workspace_id')->constrained('users')->nullOnDelete();
            $table->unsignedInteger('config_version')->default(1)->after('active');
        });
        Schema::table('webhook_deliveries', function (Blueprint $table) {
            $table->unsignedInteger('config_version')->default(1)->after('webhook_id');
            $table->timestampTz('locked_at')->nullable()->after('next_attempt_at');
        });
        DB::statement('ALTER TABLE webhook_deliveries DROP CONSTRAINT IF EXISTS webhook_deliveries_status_check');
        DB::statement("ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_status_check CHECK (status IN ('pending','processing','success','failed'))");
        DB::statement("CREATE INDEX idx_deliveries_pending_retry ON webhook_deliveries (next_attempt_at) WHERE status = 'pending'");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS idx_deliveries_pending_retry');
        DB::statement("UPDATE webhook_deliveries SET status = 'pending', locked_at = NULL WHERE status = 'processing'");
        DB::statement('ALTER TABLE webhook_deliveries DROP CONSTRAINT IF EXISTS webhook_deliveries_status_check');
        DB::statement("ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_status_check CHECK (status IN ('pending','success','failed'))");
        Schema::table('webhook_deliveries', function (Blueprint $table) {
            $table->dropColumn(['config_version', 'locked_at']);
        });
        Schema::table('webhooks', function (Blueprint $table) {
            $table->dropConstrainedForeignId('created_by');
            $table->dropColumn('config_version');
        });
    }
};
