<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Two structural changes to custom domains.
 *
 * 1. Claims. The old schema had one global unique index on `lower(domain)`, so
 *    the first workspace to *type* a hostname reserved it forever without
 *    proving anything — a tenant-against-tenant denial of service. Ownership
 *    now lives in `custom_domain_claims`, created only when a workspace proves
 *    the TXT challenge. Any number of workspaces may hold a *request* for the
 *    same hostname (uniqueness becomes per workspace); exactly one holds the
 *    claim, and only the claim holder may ever serve the hostname.
 *
 * 2. State split. The single `state` column mixed four different facts — what
 *    the user wants (`desired_state`), who owns the name (`ownership_status`),
 *    whether the CNAME points here (`routing_status`) and the certificate
 *    (`tls_status`) — which is what produced the revalidate/activate race and
 *    left a domain that fell to `error` unable to recover on its own. Serving
 *    is now derived from the four; `edge_eligible` stays as the stored
 *    projection the edge lookup reads.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('custom_domain_claims', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->string('domain');
            $table->timestampTz('claimed_at')->useCurrent();
            // Every successful ownership check refreshes this. A claim whose
            // holder stopped proving ownership ages out and may be taken over
            // by whoever controls the DNS today.
            $table->timestampTz('last_proven_at')->useCurrent();
        });
        DB::statement('CREATE UNIQUE INDEX custom_domain_claims_domain_unique ON custom_domain_claims (lower(domain))');
        DB::statement('CREATE INDEX custom_domain_claims_workspace_idx ON custom_domain_claims (workspace_id, lower(domain))');

        Schema::table('custom_domains', function (Blueprint $table) {
            $table->string('desired_state', 16)->default('enabled');
            $table->string('ownership_status', 16)->default('pending');
            $table->string('routing_status', 16)->default('unknown');
            $table->string('tls_status', 16)->default('pending');
            // 1 = the bare-hostname TXT fallback is still honoured for this
            // row; 2 = only the dedicated _uvh-verification label counts.
            $table->smallInteger('verification_scheme')->default(1);
            $table->timestampTz('reputation_checked_at')->nullable();
            $table->timestampTz('tls_checked_at')->nullable();
            $table->timestampTz('tls_not_after')->nullable();
            $table->string('tls_issuer')->nullable();
            $table->timestampTz('tls_last_attempt_at')->nullable();
            $table->timestampTz('tls_next_retry_at')->nullable();
            $table->text('root_destination')->nullable();
            $table->string('not_found_mode', 16)->nullable();
        });

        // Backfill from the legacy column before it is dropped. The old writes
        // nulled `ownership_verified_at`/`routing_verified_at` the moment a
        // check stopped seeing the record, so a non-null timestamp is exactly
        // "last check observed it".
        DB::statement(<<<'SQL'
            UPDATE custom_domains SET desired_state = 'disabled' WHERE state = 'disabled'
            SQL);
        DB::statement(<<<'SQL'
            UPDATE custom_domains SET
                ownership_status = CASE
                    WHEN ownership_verified_at IS NOT NULL THEN 'verified'
                    WHEN state = 'error' AND dns_error LIKE 'ownership%' THEN 'lost'
                    ELSE 'pending'
                END,
                routing_status = CASE
                    WHEN routing_verified_at IS NOT NULL THEN 'healthy'
                    WHEN state = 'active' AND edge_eligible = true AND dns_error IS NOT NULL THEN 'degraded'
                    WHEN state = 'error' AND (dns_error LIKE 'routing%' OR dns_error = 'ownership_and_routing_missing') THEN 'failed'
                    WHEN routing_verified_at IS NULL AND verified_at IS NOT NULL THEN 'failed'
                    ELSE 'unknown'
                END,
                tls_status = CASE
                    WHEN state = 'provisioning' THEN 'provisioning'
                    WHEN tls_ready_at IS NOT NULL THEN 'ready'
                    WHEN tls_error IS NOT NULL THEN 'error'
                    ELSE 'pending'
                END
            SQL);

        // Every domain that ever proved ownership keeps its claim under the new
        // authority. Requests that never proved anything hold nothing: proving
        // the TXT creates the claim from here on.
        DB::statement(<<<'SQL'
            INSERT INTO custom_domain_claims (domain, workspace_id, claimed_at, last_proven_at)
            SELECT DISTINCT ON (lower(domain))
                domain,
                workspace_id,
                COALESCE(verified_at, created_at),
                COALESCE(ownership_verified_at, verified_at, created_at)
            FROM custom_domains
            WHERE ownership_verified_at IS NOT NULL
            ORDER BY lower(domain), id
            ON CONFLICT DO NOTHING
            SQL);

        DB::statement('DROP INDEX IF EXISTS custom_domains_domain_unique');
        DB::statement('DROP INDEX IF EXISTS idx_domains_stale_verification');
        DB::statement('DROP INDEX IF EXISTS idx_domains_stale_tls_provisioning');
        DB::statement('DROP INDEX IF EXISTS idx_domains_active_dns_check');
        DB::statement('ALTER TABLE custom_domains DROP CONSTRAINT IF EXISTS custom_domains_state_check');
        DB::statement('ALTER TABLE custom_domains DROP CONSTRAINT IF EXISTS custom_domains_edge_eligible_state_check');
        DB::statement('ALTER TABLE custom_domains DROP CONSTRAINT IF EXISTS custom_domains_active_readiness_check');
        DB::statement('ALTER TABLE custom_domains DROP CONSTRAINT IF EXISTS custom_domains_provisioning_readiness_check');

        Schema::table('custom_domains', function (Blueprint $table) {
            $table->dropColumn('state');
        });

        // Requests are unique per workspace only; the claim table is what makes
        // a hostname exclusive across the platform. The plain lookup index
        // replaces the dropped global unique one for the edge ask and the
        // redirect host resolution, which start from the hostname alone.
        DB::statement('CREATE UNIQUE INDEX custom_domains_workspace_domain_unique ON custom_domains (workspace_id, lower(domain))');
        DB::statement('CREATE INDEX custom_domains_domain_lookup ON custom_domains (lower(domain))');

        DB::statement(<<<'SQL'
            CREATE INDEX idx_domains_enabled_dns_check ON custom_domains (dns_check_completed_at, id)
            WHERE desired_state = 'enabled'
            SQL);
        DB::statement(<<<'SQL'
            CREATE INDEX idx_domains_enabled_reputation ON custom_domains (reputation_checked_at, id)
            WHERE desired_state = 'enabled'
            SQL);
        DB::statement(<<<'SQL'
            CREATE INDEX idx_domains_tls_provisioning ON custom_domains (updated_at, id)
            WHERE tls_status = 'provisioning'
            SQL);
        DB::statement(<<<'SQL'
            CREATE INDEX idx_domains_stale_checks ON custom_domains (updated_at, id)
            WHERE dns_check_started_at IS NOT NULL AND dns_check_completed_at IS NULL
            SQL);

        DB::statement("ALTER TABLE custom_domains ADD CONSTRAINT custom_domains_desired_state_check CHECK (desired_state IN ('enabled','disabled'))");
        DB::statement("ALTER TABLE custom_domains ADD CONSTRAINT custom_domains_ownership_status_check CHECK (ownership_status IN ('pending','verified','lost'))");
        DB::statement("ALTER TABLE custom_domains ADD CONSTRAINT custom_domains_routing_status_check CHECK (routing_status IN ('unknown','healthy','degraded','failed'))");
        DB::statement("ALTER TABLE custom_domains ADD CONSTRAINT custom_domains_tls_status_check CHECK (tls_status IN ('pending','provisioning','ready','expiring','error'))");
        DB::statement("ALTER TABLE custom_domains ADD CONSTRAINT custom_domains_tls_ready_marker_check CHECK (tls_status <> 'ready' OR tls_ready_at IS NOT NULL)");
        DB::statement("ALTER TABLE custom_domains ADD CONSTRAINT custom_domains_tls_provisioning_marker_check CHECK (tls_status <> 'provisioning' OR tls_ready_at IS NULL)");
        // The edge may only ever serve a hostname whose holder intended it and
        // has a certificate (issued or in flight). Grace periods after a DNS
        // failure keep the row eligible with a ready certificate: the failure
        // lives in ownership/routing status, not in this flag.
        DB::statement(<<<'SQL'
            ALTER TABLE custom_domains ADD CONSTRAINT custom_domains_edge_eligibility_check
            CHECK (edge_eligible = false OR (
                desired_state = 'enabled'
                AND verified_at IS NOT NULL
                AND tls_status IN ('provisioning', 'ready', 'expiring')
            ))
            SQL);
    }

    public function down(): void
    {
        Schema::table('custom_domains', function (Blueprint $table) {
            $table->string('state')->default('pending');
        });

        DB::statement(<<<'SQL'
            UPDATE custom_domains SET state = CASE
                WHEN desired_state = 'disabled' THEN 'disabled'
                WHEN tls_status = 'provisioning' THEN 'provisioning'
                WHEN edge_eligible = true AND tls_ready_at IS NOT NULL THEN 'active'
                WHEN ownership_status = 'pending' AND dns_check_started_at IS NOT NULL
                    AND (dns_check_completed_at IS NULL OR dns_check_started_at > dns_check_completed_at) THEN 'verifying'
                WHEN verified_at IS NULL AND dns_error IS NOT NULL THEN 'error'
                WHEN verified_at IS NULL THEN 'pending'
                WHEN dns_error IS NOT NULL AND edge_eligible = false THEN 'error'
                ELSE 'verified'
            END
            SQL);
        DB::statement("ALTER TABLE custom_domains ADD CONSTRAINT custom_domains_state_check CHECK (state IN ('pending','verifying','verified','provisioning','active','error','disabled'))");

        DB::statement('ALTER TABLE custom_domains DROP CONSTRAINT IF EXISTS custom_domains_edge_eligibility_check');
        DB::statement('ALTER TABLE custom_domains DROP CONSTRAINT IF EXISTS custom_domains_tls_provisioning_marker_check');
        DB::statement('ALTER TABLE custom_domains DROP CONSTRAINT IF EXISTS custom_domains_tls_ready_marker_check');
        DB::statement('ALTER TABLE custom_domains DROP CONSTRAINT IF EXISTS custom_domains_tls_status_check');
        DB::statement('ALTER TABLE custom_domains DROP CONSTRAINT IF EXISTS custom_domains_routing_status_check');
        DB::statement('ALTER TABLE custom_domains DROP CONSTRAINT IF EXISTS custom_domains_ownership_status_check');
        DB::statement('ALTER TABLE custom_domains DROP CONSTRAINT IF EXISTS custom_domains_desired_state_check');

        DB::statement('DROP INDEX IF EXISTS idx_domains_stale_checks');
        DB::statement('DROP INDEX IF EXISTS idx_domains_tls_provisioning');
        DB::statement('DROP INDEX IF EXISTS idx_domains_enabled_reputation');
        DB::statement('DROP INDEX IF EXISTS idx_domains_enabled_dns_check');
        DB::statement('DROP INDEX IF EXISTS custom_domains_domain_lookup');
        DB::statement('DROP INDEX IF EXISTS custom_domains_workspace_domain_unique');

        Schema::table('custom_domains', function (Blueprint $table) {
            $table->dropColumn([
                'desired_state',
                'ownership_status',
                'routing_status',
                'tls_status',
                'verification_scheme',
                'reputation_checked_at',
                'tls_checked_at',
                'tls_not_after',
                'tls_issuer',
                'tls_last_attempt_at',
                'tls_next_retry_at',
                'root_destination',
                'not_found_mode',
            ]);
        });

        DB::statement('CREATE UNIQUE INDEX custom_domains_domain_unique ON custom_domains (lower(domain))');
        DB::statement("CREATE INDEX idx_domains_stale_verification ON custom_domains (updated_at, id) WHERE state = 'verifying'");
        DB::statement("CREATE INDEX idx_domains_stale_tls_provisioning ON custom_domains (updated_at, id) WHERE state = 'provisioning'");
        DB::statement("CREATE INDEX idx_domains_active_dns_check ON custom_domains (dns_check_completed_at, id) WHERE state = 'active'");
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

        Schema::dropIfExists('custom_domain_claims');
    }
};
