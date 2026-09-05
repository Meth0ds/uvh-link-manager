<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // No account FK: deleting a sender must not reset shared IP/recipient
        // allowances. Only domain-separated HMAC keys and transient counters live here.
        Schema::create('invitation_mail_budgets', function (Blueprint $table) {
            $table->string('budget_key', 64)->primary();
            $table->unsignedInteger('used')->default(0);
            $table->bigInteger('expires_at_epoch');
            $table->index('expires_at_epoch', 'invitation_mail_budget_expiry_idx');
        });
        DB::statement('ALTER TABLE invitation_mail_budgets ADD CONSTRAINT invitation_mail_budget_used_check CHECK (used >= 0)');
        DB::statement('ALTER TABLE invitation_mail_budgets ADD CONSTRAINT invitation_mail_budget_expiry_check CHECK (expires_at_epoch >= 0)');
    }

    public function down(): void
    {
        // Roll back the application first: dropping live counters resets abuse
        // allowances and the new application deliberately fails closed without them.
        Schema::dropIfExists('invitation_mail_budgets');
    }
};
