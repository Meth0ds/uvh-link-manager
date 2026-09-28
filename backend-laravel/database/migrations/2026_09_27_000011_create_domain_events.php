<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The domain event outbox.
 *
 * Domain state must be confirmable no matter what an external integration is
 * doing: a saturated webhook backlog used to throw inside the verification
 * transaction and roll back a DNS result that had already been observed. Every
 * domain transition now records its event here in the same transaction as the
 * state write, and fan-out to webhooks and the notification center happens
 * afterwards with its own retries. The same rows are the domain's activity
 * timeline, so history and delivery are one durable fact.
 *
 * `domain_id` deliberately has no foreign key: the `domain.deleted` event must
 * outlive the row it announces.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('domain_events', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('domain_id');
            $table->string('domain');
            $table->string('event', 64);
            $table->jsonb('payload')->default('{}');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('dispatched_at')->nullable();
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->timestampTz('next_attempt_at')->nullable();
        });
        DB::statement('CREATE INDEX idx_domain_events_pending ON domain_events (next_attempt_at, id) WHERE dispatched_at IS NULL');
        DB::statement('CREATE INDEX idx_domain_events_timeline ON domain_events (domain_id, id)');
    }

    public function down(): void
    {
        Schema::dropIfExists('domain_events');
    }
};
