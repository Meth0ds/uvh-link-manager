<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('operational_metrics', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('metric', 64);
            $table->timestampTz('bucket_at');
            $table->unsignedBigInteger('count')->default(0);
            $table->unique(['metric', 'bucket_at'], 'operational_metrics_bucket_unique');
            $table->index('bucket_at', 'operational_metrics_retention_idx');
        });
        DB::statement('ALTER TABLE operational_metrics ADD CONSTRAINT operational_metrics_count_check CHECK (count >= 0)');

        Schema::table('mail_outbox', function (Blueprint $table) {
            $table->unsignedSmallInteger('manual_retry_count')->default(0)->after('attempts');
            $table->timestampTz('last_manual_retry_at')->nullable()->after('failed_at');
        });
        DB::statement('ALTER TABLE mail_outbox ADD CONSTRAINT mail_outbox_manual_retry_count_check CHECK (manual_retry_count <= 3)');
        DB::statement('ALTER TABLE mail_outbox DROP CONSTRAINT mail_outbox_status_check');
        DB::statement("ALTER TABLE mail_outbox ADD CONSTRAINT mail_outbox_status_check CHECK (status IN ('pending','queued','processing','sent','failed','obsolete'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE mail_outbox DROP CONSTRAINT mail_outbox_status_check');
        // `obsolete` did not exist before this migration. Preserve the
        // terminal record in the closest legacy state so rollback never fails
        // while installing the old CHECK constraint.
        DB::table('mail_outbox')->where('status', 'obsolete')->update([
            'status' => 'failed',
            'last_error' => 'lifecycle_obsolete',
            'failed_at' => DB::raw('COALESCE(failed_at, NOW())'),
            'updated_at' => DB::raw('NOW()'),
        ]);
        DB::statement("ALTER TABLE mail_outbox ADD CONSTRAINT mail_outbox_status_check CHECK (status IN ('pending','queued','processing','sent','failed'))");
        Schema::table('mail_outbox', function (Blueprint $table) {
            $table->dropColumn(['manual_retry_count', 'last_manual_retry_at']);
        });
        Schema::dropIfExists('operational_metrics');
    }
};
