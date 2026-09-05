<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // Rows predating routed-DNS/TLS tracking were deliberately made
        // ineligible. Demote any such apparent active state before enforcing
        // the invariant; it must pass verification again rather than route on
        // stale historical state.
        DB::statement(<<<'SQL'
            UPDATE custom_domains
            SET state = 'error',
                verified_at = NULL,
                edge_eligible = false,
                tls_ready_at = NULL,
                dns_error = COALESCE(dns_error, 'reverification_required'),
                updated_at = NOW()
            WHERE state = 'active'
              AND (
                edge_eligible = false OR tls_ready_at IS NULL OR verified_at IS NULL
                OR (dns_error IS NULL AND (ownership_verified_at IS NULL OR routing_verified_at IS NULL))
              )
            SQL);
        DB::statement(<<<'SQL'
            UPDATE custom_domains
            SET state = 'verified',
                edge_eligible = false,
                tls_ready_at = NULL,
                tls_error = COALESCE(tls_error, 'invariant_repair'),
                updated_at = NOW()
            WHERE state = 'provisioning'
              AND (verified_at IS NULL OR ownership_verified_at IS NULL OR routing_verified_at IS NULL)
            SQL);

        DB::statement(<<<'SQL'
            ALTER TABLE custom_domains
            ADD CONSTRAINT custom_domains_edge_eligible_state_check
            CHECK (edge_eligible = false OR state IN ('provisioning', 'active'))
            SQL);
        DB::statement(<<<'SQL'
            ALTER TABLE custom_domains
            ADD CONSTRAINT custom_domains_active_readiness_check
            CHECK (
              state <> 'active' OR (
                edge_eligible = true AND tls_ready_at IS NOT NULL AND verified_at IS NOT NULL
                AND (
                  dns_error IS NOT NULL
                  OR (ownership_verified_at IS NOT NULL AND routing_verified_at IS NOT NULL)
                )
              )
            )
            SQL);
        DB::statement(<<<'SQL'
            ALTER TABLE custom_domains
            ADD CONSTRAINT custom_domains_provisioning_readiness_check
            CHECK (
              state <> 'provisioning' OR (
                edge_eligible = true AND tls_ready_at IS NULL AND verified_at IS NOT NULL
                AND ownership_verified_at IS NOT NULL AND routing_verified_at IS NOT NULL
              )
            )
            SQL);
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE custom_domains DROP CONSTRAINT IF EXISTS custom_domains_provisioning_readiness_check');
        DB::statement('ALTER TABLE custom_domains DROP CONSTRAINT IF EXISTS custom_domains_active_readiness_check');
        DB::statement('ALTER TABLE custom_domains DROP CONSTRAINT IF EXISTS custom_domains_edge_eligible_state_check');
    }
};
