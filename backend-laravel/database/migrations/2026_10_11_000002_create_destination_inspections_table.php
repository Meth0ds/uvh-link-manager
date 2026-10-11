<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('destination_inspections', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('link_id')->nullable()->constrained()->cascadeOnDelete();
            $table->unsignedInteger('link_version')->nullable();
            $table->unsignedInteger('security_version');
            $table->string('session_id', 128);
            $table->string('mode', 12);
            $table->string('fingerprint', 64);
            $table->text('url_ciphertext');
            $table->string('status', 12)->default('pending');
            $table->jsonb('result')->nullable();
            $table->text('icon_ciphertext')->nullable();
            $table->timestampTz('expires_at');
            $table->timestampsTz();
            $table->index(['workspace_id', 'user_id', 'fingerprint']);
            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('destination_inspections');
    }
};
