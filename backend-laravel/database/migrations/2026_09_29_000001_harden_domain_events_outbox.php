<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * A claimable, per-channel delivery state for the domain event outbox.
 *
 * Two consumers run over the same rows — the post-commit fan-out job and the
 * minute-by-minute housekeeping sweep — and delivery used to be "read, send,
 * mark", so both could legitimately deliver the same event twice. `locked_at`
 * gives each delivery a bounded lease: only the claim winner sends.
 *
 * The two `*_dispatched_at` columns track the webhook and notification
 * channels independently. A saturated webhook backlog must never swallow the
 * alert a domain owner needs (and a broken notification path must not stall an
 * integration), so each channel finishes, retries and gives up on its own
 * budget. `dispatched_at` keeps its meaning for retention: "nothing left to
 * do", now derived from both channels.
 *
 * `event_uuid` is the external identity of the event: created with the row and
 * never regenerated, so a receiver can deduplicate retries and re-deliveries
 * by `event_id` exactly as the API contract tells it to.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('domain_events', function (Blueprint $table) {
            $table->uuid('event_uuid')->nullable()->unique();
            $table->timestampTz('locked_at')->nullable();
            $table->timestampTz('webhook_dispatched_at')->nullable();
            $table->timestampTz('notice_dispatched_at')->nullable();
            $table->unsignedSmallInteger('notice_attempts')->default(0);
            $table->timestampTz('notice_next_attempt_at')->nullable();
        });

        // History rows get an identity too: a stored delivery preview or a
        // late consumer must never see a regenerated id.
        DB::table('domain_events')->whereNull('event_uuid')->orderBy('id')
            ->chunkById(500, function ($rows): void {
                foreach ($rows as $row) {
                    DB::table('domain_events')->where('id', $row->id)
                        ->update(['event_uuid' => (string) Str::uuid()]);
                }
            });
    }

    public function down(): void
    {
        Schema::table('domain_events', function (Blueprint $table) {
            $table->dropColumn([
                'event_uuid',
                'locked_at',
                'webhook_dispatched_at',
                'notice_dispatched_at',
                'notice_attempts',
                'notice_next_attempt_at',
            ]);
        });
    }
};
