<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('abuse_reports', function (Blueprint $table) {
            $table->string('reporter_hash', 64)->nullable()->after('reporter_email');
            $table->string('report_day', 10)->nullable()->after('reporter_hash');
        });
        DB::statement('CREATE UNIQUE INDEX abuse_reports_link_reporter_day_unique ON abuse_reports (link_id, reporter_hash, report_day) WHERE reporter_hash IS NOT NULL');
        DB::statement('CREATE INDEX abuse_reports_link_day_index ON abuse_reports (link_id, report_day)');

        // Existing hooks cannot be attributed safely after the schema gains an
        // owner. Disable them until an active member explicitly re-creates one.
        DB::statement('UPDATE webhooks SET active = false, config_version = config_version + 1 WHERE created_by IS NULL AND active = true');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS abuse_reports_link_reporter_day_unique');
        DB::statement('DROP INDEX IF EXISTS abuse_reports_link_day_index');
        Schema::table('abuse_reports', function (Blueprint $table) {
            $table->dropColumn(['reporter_hash', 'report_day']);
        });
    }
};
