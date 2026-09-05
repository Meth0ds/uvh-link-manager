<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('email_change_requests', function (Blueprint $table) {
            // Only the SHA-256 digest is persisted. The bearer sent by email
            // cannot be recovered from a database snapshot.
            $table->string('id', 64)->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('new_email');
            $table->unsignedInteger('security_version');
            $table->timestampTz('expires_at');
            $table->timestampTz('created_at')->useCurrent();
            $table->unique('user_id', 'email_change_requests_user_unique');
        });

        // Reserve a destination mailbox while its proof is pending. Terminal
        // and expired rows are deleted by the controller before replacement.
        DB::statement('CREATE UNIQUE INDEX email_change_requests_email_unique ON email_change_requests (lower(new_email))');
        DB::statement('CREATE INDEX email_change_requests_expiry_idx ON email_change_requests (expires_at)');
    }

    public function down(): void
    {
        Schema::dropIfExists('email_change_requests');
    }
};
