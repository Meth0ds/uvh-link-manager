<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('registration_link_handoffs', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('pending_registration_id')->nullable()->unique()->constrained('pending_registrations')->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->unique()->constrained('users')->cascadeOnDelete();
            $table->string('intent_hash', 64)->index();
            $table->text('encrypted_token');
            $table->integer('security_version')->nullable();
            $table->timestampTz('expires_at')->index();
            $table->timestampTz('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('registration_link_handoffs');
    }
};
