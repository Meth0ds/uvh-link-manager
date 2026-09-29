<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One TLS probe round per domain, recognizable in the database.
 *
 * `queueTlsProbeChecks()` used to enqueue a probe for every stale row on every
 * pass; when the `domains` queue was behind, each minute's pass enqueued the
 * same monitoring round again, and three copies of one round could count as
 * three probe failures and withdraw a domain that was actually serving. The
 * sweep now claims each row before dispatching (a `tls_probe_version`
 * generation plus `tls_probe_started_at`, with a lease that recovers a lost
 * job), and `ProbeDomainTlsJob` may only apply its result while its generation
 * is still current and the round is still open: a duplicate writes nothing.
 *
 * The generation lives in the row — not in a cache lock — because the decision
 * it guards can take customer traffic down.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('custom_domains', function (Blueprint $table) {
            // Generation captured by each queued probe round; a delayed job
            // applies its result only while the generation still matches.
            $table->unsignedBigInteger('tls_probe_version')->default(0);
            $table->timestampTz('tls_probe_started_at')->nullable();
            $table->timestampTz('tls_probe_completed_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('custom_domains', function (Blueprint $table) {
            $table->dropColumn(['tls_probe_version', 'tls_probe_started_at', 'tls_probe_completed_at']);
        });
    }
};
