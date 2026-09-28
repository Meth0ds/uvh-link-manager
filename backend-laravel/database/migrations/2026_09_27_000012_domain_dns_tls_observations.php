<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What UVH actually saw, as opposed to what it concluded.
 *
 * The status columns answer "is this domain healthy?"; they cannot answer "why
 * not?". A user whose CNAME is wrong needs to know what the resolver returned
 * instead (`routing_observed_target`), whether a proxy like Cloudflare is in
 * the middle (`routing_observed_proxied`) and whether a CAA record blocks the
 * certificate issuer (`caa_records`/`caa_allows_issuer`) — the difference
 * between "routing_missing" and an actionable instruction.
 *
 * The TLS half supports certificate lifetime monitoring: Caddy renews
 * certificates on its own, but nothing inside the platform used to notice a
 * renewal that stopped happening. `tls_not_after`/`tls_issuer` are captured
 * from the real handshake through the edge, and `tls_probe_failures` gives a
 * transient probe failure the same grace the DNS checks have before a domain
 * that is actually serving is taken down.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('custom_domains', function (Blueprint $table) {
            // Last observation snapshot; every DNS check refreshes it.
            $table->timestampTz('dns_observed_at')->nullable();
            // Ownership detail: a TXT record exists at the challenge label but
            // carries the wrong value is a very different instruction from no
            // record at all.
            $table->boolean('ownership_txt_present')->nullable();
            // Routing detail: what answered at the hostname.
            $table->string('routing_observed_target')->nullable();
            $table->integer('routing_observed_ttl')->nullable();
            $table->json('routing_observed_addresses')->nullable();
            $table->boolean('routing_observed_proxied')->nullable();
            // CAA detail: the raw records and whether they admit the platform's
            // ACME issuer. Null means "no CAA restriction observed".
            $table->json('caa_records')->nullable();
            $table->boolean('caa_allows_issuer')->nullable();
            // Consecutive failed TLS probes. A serving domain keeps serving on
            // the first failures; only sustained failure withdraws it.
            $table->smallInteger('tls_probe_failures')->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('custom_domains', function (Blueprint $table) {
            $table->dropColumn([
                'dns_observed_at',
                'ownership_txt_present',
                'routing_observed_target',
                'routing_observed_ttl',
                'routing_observed_addresses',
                'routing_observed_proxied',
                'caa_records',
                'caa_allows_issuer',
                'tls_probe_failures',
            ]);
        });
    }
};
