<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('links', function (Blueprint $table): void {
            $table->jsonb('expired_page')->nullable();
            $table->unsignedInteger('expiry_notice_generation')->default(1);
            $table->unsignedInteger('limit_notice_generation')->default(1);
            $table->index(['workspace_id', 'utm_campaign', 'id']);
        });
        Schema::create('link_favorites', function (Blueprint $table): void {
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->foreignId('link_id')->constrained()->cascadeOnDelete();
            $table->timestampTz('created_at');
            $table->primary(['user_id', 'workspace_id', 'link_id']);
            $table->index('link_id');
        });
        Schema::create('saved_link_filters', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->string('name', 80);
            $table->jsonb('spec');
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();
            $table->index(['user_id', 'workspace_id', 'id']);
        });
        Schema::create('link_duplicate_receipts', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('source_link_id');
            $table->unsignedBigInteger('link_id');
            $table->string('idempotency_key', 128);
            $table->string('request_hash', 64);
            $table->timestampTz('created_at');
            $table->unique(['user_id', 'workspace_id', 'idempotency_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('link_duplicate_receipts');
        Schema::dropIfExists('saved_link_filters');
        Schema::dropIfExists('link_favorites');
        Schema::table('links', function (Blueprint $table): void {
            $table->dropIndex(['workspace_id', 'utm_campaign', 'id']);
            $table->dropColumn(['expired_page', 'expiry_notice_generation', 'limit_notice_generation']);
        });
    }
};
