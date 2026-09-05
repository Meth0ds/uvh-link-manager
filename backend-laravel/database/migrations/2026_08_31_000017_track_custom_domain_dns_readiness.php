<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('custom_domains', function (Blueprint $table) {
            $table->timestampTz('ownership_verified_at')->nullable();
            $table->timestampTz('routing_verified_at')->nullable();
            $table->timestampTz('dns_check_started_at')->nullable();
            $table->timestampTz('dns_check_completed_at')->nullable();
            $table->string('dns_error', 64)->nullable();
            $table->unsignedSmallInteger('dns_failure_count')->default(0);
            $table->timestampTz('dns_first_failed_at')->nullable();
            // This is intentionally false for pre-existing rows. They must
            // pass the new TXT+CNAME verification before the TLS edge may
            // issue/serve a certificate for them.
            $table->boolean('edge_eligible')->default(false);
        });

        DB::statement('UPDATE custom_domains SET ownership_verified_at = verified_at WHERE verified_at IS NOT NULL');
        DB::statement("CREATE INDEX idx_domains_active_dns_check ON custom_domains (dns_check_completed_at, id) WHERE state = 'active'");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS idx_domains_active_dns_check');
        Schema::table('custom_domains', function (Blueprint $table) {
            $table->dropColumn([
                'ownership_verified_at',
                'routing_verified_at',
                'dns_check_started_at',
                'dns_check_completed_at',
                'dns_error',
                'dns_failure_count',
                'dns_first_failed_at',
                'edge_eligible',
            ]);
        });
    }
};
