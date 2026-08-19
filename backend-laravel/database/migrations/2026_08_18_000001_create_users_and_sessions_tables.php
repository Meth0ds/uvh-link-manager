<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('email'); // unique index on lower(email) in the indexes migration
            $table->string('name');
            $table->string('password_hash');
            $table->timestampTz('email_verified_at')->nullable();
            $table->boolean('is_admin')->default(false);
            $table->boolean('mfa_enabled')->default(false);
            $table->text('mfa_secret')->nullable();
            $table->jsonb('recovery_codes')->nullable();
            $table->timestampsTz();
            $table->timestampTz('deleted_at')->nullable();
        });

        Schema::create('sessions', function (Blueprint $table) {
            $table->string('id', 64)->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('user_agent')->nullable();
            $table->string('ip_hash')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('last_used_at')->useCurrent();
            $table->timestampTz('expires_at');
            $table->timestampTz('revoked_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sessions');
        Schema::dropIfExists('users');
    }
};
