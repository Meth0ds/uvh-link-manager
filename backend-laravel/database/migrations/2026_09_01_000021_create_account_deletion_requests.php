<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('account_deletion_requests', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->unsignedInteger('security_version');
            $table->string('status')->default('requested');
            $table->string('confirmation_token_hash', 64)->nullable()->unique();
            $table->string('cancel_token_hash', 64)->nullable()->unique();
            $table->timestampTz('confirmation_expires_at')->nullable();
            $table->timestampTz('execute_after')->nullable();
            $table->timestampTz('confirmed_at')->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->timestampTz('executed_at')->nullable();
            $table->timestampsTz();
        });
        DB::statement("ALTER TABLE account_deletion_requests ADD CONSTRAINT account_deletion_requests_status_check CHECK (status IN ('requested','scheduled','cancelled','executed','expired','blocked'))");
        DB::statement('CREATE INDEX account_deletion_requests_execute_idx ON account_deletion_requests (execute_after)');
    }

    public function down(): void
    {
        Schema::dropIfExists('account_deletion_requests');
    }
};
