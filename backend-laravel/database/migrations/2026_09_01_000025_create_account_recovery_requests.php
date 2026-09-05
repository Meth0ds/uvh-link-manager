<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('account_recovery_requests', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('security_version');
            $table->string('status', 24)->default('requested');
            $table->string('confirmation_token_hash', 64)->nullable()->unique();
            $table->timestampTz('confirmation_expires_at')->nullable();
            $table->string('completion_token_hash', 64)->nullable()->unique();
            $table->timestampTz('completion_expires_at')->nullable();
            $table->timestampTz('email_confirmed_at')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->timestampTz('rejected_at')->nullable();
            $table->timestampTz('completed_at')->nullable();
            $table->timestampTz('expires_at');
            $table->timestampsTz();
        });
        DB::statement("ALTER TABLE account_recovery_requests ADD CONSTRAINT account_recovery_requests_status_check CHECK (status IN ('requested','email_confirmed','in_review','approved','rejected','completed','expired','cancelled'))");
        DB::statement("CREATE UNIQUE INDEX account_recovery_requests_user_active_unique ON account_recovery_requests (user_id) WHERE status IN ('requested','email_confirmed','in_review','approved')");
        DB::statement('CREATE INDEX account_recovery_requests_status_expiry_idx ON account_recovery_requests (status, expires_at, id)');

        Schema::create('account_recovery_approvals', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('request_id')->constrained('account_recovery_requests')->cascadeOnDelete();
            $table->foreignId('admin_user_id')->constrained('users')->restrictOnDelete();
            // Only a code is persisted; identity documents and free-form PII
            // belong in the separately governed support system.
            $table->string('reason_code', 48);
            $table->timestampTz('created_at')->useCurrent();
            $table->unique(['request_id', 'admin_user_id'], 'account_recovery_approval_actor_unique');
        });
        DB::statement("ALTER TABLE account_recovery_approvals ADD CONSTRAINT account_recovery_approvals_reason_check CHECK (reason_code = 'identity_verified_external')");
    }

    public function down(): void
    {
        Schema::dropIfExists('account_recovery_approvals');
        Schema::dropIfExists('account_recovery_requests');
    }
};
