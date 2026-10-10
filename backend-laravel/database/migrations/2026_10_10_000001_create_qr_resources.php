<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('qr_assets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->uuid('request_key');
            $table->char('input_hash', 64);
            $table->string('path', 180);
            $table->unsignedInteger('bytes');
            $table->unsignedSmallInteger('width');
            $table->unsignedSmallInteger('height');
            $table->string('status', 16)->default('pending');
            $table->timestampsTz();
            $table->unique(['workspace_id', 'request_key']);
            $table->index(['status', 'created_at']);
        });
        Schema::create('qr_designs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('name', 80);
            $table->jsonb('spec');
            $table->foreignId('asset_id')->nullable()->constrained('qr_assets')->restrictOnDelete();
            $table->unsignedInteger('version')->default(1);
            $table->uuid('request_key');
            $table->char('request_hash', 64);
            $table->timestampsTz();
            $table->unique(['workspace_id', 'request_key']);
            $table->index(['workspace_id', 'name']);
            $table->index('asset_id');
        });
        Schema::create('qr_variants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->foreignId('link_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('name', 80);
            $table->char('public_id', 32)->unique();
            $table->jsonb('spec');
            $table->foreignId('asset_id')->nullable()->constrained('qr_assets')->restrictOnDelete();
            $table->unsignedInteger('version')->default(1);
            $table->timestampTz('archived_at')->nullable();
            $table->uuid('request_key');
            $table->char('request_hash', 64);
            $table->timestampsTz();
            $table->unique(['workspace_id', 'request_key']);
            $table->index(['link_id', 'id']);
            $table->index('asset_id');
        });
        Schema::table('click_events', function (Blueprint $table) {
            $table->foreignId('qr_variant_id')->nullable()->constrained('qr_variants')->nullOnDelete();
        });
        Schema::create('qr_daily_counts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('variant_id')->constrained('qr_variants')->cascadeOnDelete();
            $table->date('day');
            $table->unsignedBigInteger('visits')->default(0);
            $table->unique(['variant_id', 'day']);
            $table->index(['day', 'variant_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('qr_daily_counts');
        Schema::table('click_events', fn (Blueprint $table) => $table->dropConstrainedForeignId('qr_variant_id'));
        Schema::dropIfExists('qr_variants');
        Schema::dropIfExists('qr_designs');
        Schema::dropIfExists('qr_assets');
    }
};
