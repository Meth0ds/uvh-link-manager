<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('abuse_reports', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('link_id')->constrained()->cascadeOnDelete();
            $table->string('reporter_email')->nullable();
            $table->string('reason');
            $table->text('details')->nullable();
            $table->string('status')->default('open');
            $table->timestampTz('created_at')->useCurrent();
        });
        DB::statement("ALTER TABLE abuse_reports ADD CONSTRAINT abuse_reports_status_check CHECK (status IN ('open','reviewed','actioned','dismissed'))");

        Schema::create('audit_events', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('action');
            $table->string('resource_type')->nullable();
            $table->string('resource_id')->nullable();
            $table->jsonb('metadata')->nullable();
            $table->string('ip_hash')->nullable();
            $table->timestampTz('created_at')->useCurrent();
        });

        Schema::create('email_tokens', function (Blueprint $table) {
            $table->string('id', 64)->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('kind');
            $table->timestampTz('expires_at');
            $table->timestampTz('used_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
        });
        DB::statement("ALTER TABLE email_tokens ADD CONSTRAINT email_tokens_kind_check CHECK (kind IN ('verify','reset','mfa_recovery'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('email_tokens');
        Schema::dropIfExists('audit_events');
        Schema::dropIfExists('abuse_reports');
    }
};
