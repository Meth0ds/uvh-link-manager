<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('analytics_reports', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->uuid('public_id')->unique();
            $table->string('secret_digest', 64);
            $table->text('secret_encrypted');
            $table->jsonb('spec');
            $table->string('password_hash')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->unsignedInteger('access_version')->default(1);
            $table->timestampTz('expires_at')->nullable();
            $table->timestampTz('revoked_at')->nullable();
            $table->timestampsTz();
            $table->index(['workspace_id', 'id']);
        });
        Schema::create('analytics_report_links', function (Blueprint $table): void {
            $table->foreignId('report_id')->constrained('analytics_reports')->cascadeOnDelete();
            // Keep missing references detectable after a permanent purge.
            $table->unsignedBigInteger('link_id');
            $table->string('public_label', 120);
            $table->primary(['report_id', 'link_id']);
            $table->index('link_id');
        });
        Schema::create('social_preview_assets', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->uuid('public_id')->unique();
            $table->string('request_key', 64);
            $table->string('input_hash', 64);
            $table->string('path');
            $table->unsignedInteger('bytes');
            $table->string('status', 16)->default('pending');
            $table->timestampsTz();
            $table->unique(['workspace_id', 'request_key']);
        });
        Schema::table('links', function (Blueprint $table): void {
            $table->jsonb('social_preview')->nullable();
            $table->uuid('social_public_id')->nullable()->unique();
        });
    }

    public function down(): void
    {
        Schema::table('links', fn (Blueprint $table) => $table->dropColumn(['social_preview', 'social_public_id']));
        Schema::dropIfExists('social_preview_assets');
        Schema::dropIfExists('analytics_report_links');
        Schema::dropIfExists('analytics_reports');
    }
};
