<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('account_deletion_lifecycle_audits', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('request_id')->nullable()->constrained('account_deletion_requests')->nullOnDelete();
            // Identity and reason survive a later request generation or removal.
            $table->bigInteger('affected_request_id');
            $table->string('action', 64);
            $table->timestampTz('lifecycle_at', 3);
        });
        DB::statement('ALTER TABLE account_deletion_lifecycle_audits ADD CONSTRAINT deletion_lifecycle_audits_identity CHECK (id > 0 AND affected_request_id > 0 AND (request_id IS NULL OR request_id = affected_request_id))');
        DB::statement("ALTER TABLE account_deletion_lifecycle_audits ADD CONSTRAINT deletion_lifecycle_audits_action CHECK (action IN ('account.deletion_blocked', 'account.deletion_cancelled_mail_unconfirmed'))");
    }

    public function down(): void
    {
        if (DB::table('account_deletion_lifecycle_audits')->exists()) {
            throw new RuntimeException('Cannot remove deletion lifecycle audit receipts while recovery is pending. Reconcile them before rolling back this schema.');
        }
        Schema::dropIfExists('account_deletion_lifecycle_audits');
    }
};
