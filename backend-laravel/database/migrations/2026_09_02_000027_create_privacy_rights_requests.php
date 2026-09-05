<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('privacy_rights_requests', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->unsignedInteger('security_version');
            $table->string('type', 24);
            $table->string('status', 24)->default('submitted');
            $table->string('generation_hash', 64);
            $table->foreignId('assigned_admin_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('identity_verified_at')->nullable();
            $table->timestampTz('acknowledged_at')->nullable();
            $table->timestampTz('due_at');
            $table->timestampTz('extended_until')->nullable();
            $table->string('extension_reason_code', 32)->nullable();
            $table->timestampTz('completed_at')->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->timestampsTz();
            $table->index(['status', 'due_at', 'id'], 'privacy_rights_due_idx');
            $table->index(['user_id', 'created_at'], 'privacy_rights_user_idx');
        });
        DB::statement("ALTER TABLE privacy_rights_requests ADD CONSTRAINT privacy_rights_type_check CHECK (type IN ('access','rectification','erasure','objection','restriction','portability'))");
        DB::statement("ALTER TABLE privacy_rights_requests ADD CONSTRAINT privacy_rights_status_check CHECK (status IN ('submitted','in_progress','waiting_user','completed','rejected','cancelled'))");
        DB::statement("ALTER TABLE privacy_rights_requests ADD CONSTRAINT privacy_rights_extension_reason_check CHECK (extension_reason_code IS NULL OR extension_reason_code IN ('complexity','request_volume'))");
        DB::statement("CREATE UNIQUE INDEX privacy_rights_user_type_active_unique ON privacy_rights_requests (user_id, type) WHERE status IN ('submitted','in_progress','waiting_user')");

        Schema::create('privacy_rights_messages', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('request_id')->constrained('privacy_rights_requests')->cascadeOnDelete();
            $table->string('author_role', 12);
            $table->foreignId('author_user_id')->nullable()->constrained('users')->nullOnDelete();
            // Free-form request/response content can contain personal data and
            // is therefore encrypted with authenticated application crypto.
            $table->text('encrypted_body');
            $table->timestampTz('created_at')->useCurrent();
            $table->index(['request_id', 'created_at', 'id'], 'privacy_rights_messages_idx');
        });
        DB::statement("ALTER TABLE privacy_rights_messages ADD CONSTRAINT privacy_rights_message_author_check CHECK (author_role IN ('user','admin','system'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('privacy_rights_messages');
        Schema::dropIfExists('privacy_rights_requests');
    }
};
