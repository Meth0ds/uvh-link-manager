<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('data_export_requests', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('security_version');
            $table->string('status')->default('requested');
            $table->string('confirmation_token_hash', 64)->nullable()->unique();
            $table->timestampTz('confirmation_expires_at')->nullable();
            $table->string('download_token_hash', 64)->nullable()->unique();
            $table->timestampTz('download_expires_at')->nullable();
            $table->text('artifact_path')->nullable();
            $table->timestampTz('confirmed_at')->nullable();
            $table->timestampTz('ready_at')->nullable();
            $table->timestampTz('downloaded_at')->nullable();
            $table->timestampsTz();
        });
        DB::statement("ALTER TABLE data_export_requests ADD CONSTRAINT data_export_requests_status_check CHECK (status IN ('requested','processing','ready','downloaded','failed','cancelled','expired'))");
        DB::statement("CREATE UNIQUE INDEX data_export_requests_user_active_unique ON data_export_requests (user_id) WHERE status IN ('requested','processing','ready')");
        DB::statement('CREATE INDEX data_export_requests_expiry_idx ON data_export_requests (download_expires_at)');
    }

    public function down(): void
    {
        Schema::dropIfExists('data_export_requests');
    }
};
