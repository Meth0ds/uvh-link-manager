<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('app_link_profiles', function (Blueprint $table) {
            $table->id();
            $table->uuid('public_id')->unique();
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->foreignId('domain_id')->unique()->constrained('custom_domains')->cascadeOnDelete();
            $table->string('name', 120);
            $table->boolean('enabled')->default(false);
            $table->string('ios_app_id', 255)->nullable();
            $table->string('android_package', 255)->nullable();
            $table->jsonb('android_fingerprints');
            $table->jsonb('route_prefixes');
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();
        });
        Schema::table('links', fn (Blueprint $table) => $table->jsonb('app_opening')->nullable());
        Schema::create('app_link_admissions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('link_id')->constrained()->cascadeOnDelete();
            $table->uuid('attempt_id');
            $table->unsignedInteger('link_version');
            $table->unsignedInteger('password_version');
            $table->unsignedInteger('profile_version')->nullable();
            $table->string('context_hash', 64);
            $table->text('outcome_encrypted');
            $table->timestampTz('expires_at')->index();
            $table->timestampTz('created_at');
            $table->unique(['link_id', 'attempt_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('app_link_admissions');
        Schema::table('links', fn (Blueprint $table) => $table->dropColumn('app_opening'));
        Schema::dropIfExists('app_link_profiles');
    }
};
