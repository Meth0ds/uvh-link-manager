<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mail_outbox', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('idempotency_key', 64)->unique();
            // Recipient, subject, bodies and bearer URLs remain inside this
            // authenticated encrypted envelope; none are queryable in clear.
            $table->text('encrypted_envelope');
            $table->string('kind', 64);
            $table->string('resource_type', 64)->nullable();
            $table->string('resource_id', 191)->nullable();
            $table->string('resource_generation', 128)->nullable();
            $table->string('status', 16)->default('pending');
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->timestampTz('available_at')->useCurrent();
            $table->timestampTz('queued_at')->nullable();
            $table->timestampTz('locked_at')->nullable();
            $table->string('lock_token', 64)->nullable();
            $table->timestampTz('sent_at')->nullable();
            $table->timestampTz('failed_at')->nullable();
            $table->string('last_error', 64)->nullable();
            $table->timestampsTz();
            $table->index(['status', 'available_at', 'id'], 'mail_outbox_dispatch_idx');
            $table->index(['status', 'queued_at'], 'mail_outbox_queued_idx');
            $table->index(['status', 'locked_at'], 'mail_outbox_locked_idx');
        });
        DB::statement("ALTER TABLE mail_outbox ADD CONSTRAINT mail_outbox_status_check CHECK (status IN ('pending','queued','processing','sent','failed'))");
        DB::statement('ALTER TABLE mail_outbox ADD CONSTRAINT mail_outbox_attempts_check CHECK (attempts <= 100)');
    }

    public function down(): void
    {
        Schema::dropIfExists('mail_outbox');
    }
};
