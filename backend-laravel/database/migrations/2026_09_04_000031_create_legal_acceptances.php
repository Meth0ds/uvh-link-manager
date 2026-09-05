<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('legal_acceptances', function (Blueprint $table) {
            $table->bigIncrements('id');
            // Keep the evidence minimal: IP and user-agent are unnecessary for
            // the registration contract and would expand privacy obligations.
            $table->foreignId('user_id')->constrained('users')->restrictOnDelete();
            $table->string('document_type', 24);
            $table->string('version', 32);
            $table->string('source', 24)->default('registration');
            $table->timestampTz('accepted_at');
            $table->unique(['user_id', 'document_type', 'version'], 'legal_acceptance_user_document_unique');
            $table->index(['document_type', 'version', 'accepted_at'], 'legal_acceptance_document_idx');
        });

        DB::statement("ALTER TABLE legal_acceptances ADD CONSTRAINT legal_acceptance_document_check CHECK (document_type IN ('terms','privacy_notice'))");
        DB::statement("ALTER TABLE legal_acceptances ADD CONSTRAINT legal_acceptance_source_check CHECK (source IN ('registration','material_update'))");

        // Import only evidence that already exists. There was no historical
        // privacy-notice version, so fabricating one here would be misleading.
        DB::statement(<<<'SQL'
            INSERT INTO legal_acceptances (user_id, document_type, version, source, accepted_at)
            SELECT DISTINCT ON (a.user_id, a.resource_id)
                a.user_id,
                'terms',
                a.resource_id,
                'registration',
                a.created_at
            FROM audit_events a
            JOIN users u ON u.id = a.user_id
            WHERE a.action = 'auth.terms_accepted'
              AND a.resource_type = 'consent'
              AND a.resource_id IS NOT NULL
              AND length(a.resource_id) BETWEEN 1 AND 32
            ORDER BY a.user_id, a.resource_id, a.created_at ASC
            ON CONFLICT DO NOTHING
        SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('legal_acceptances');
    }
};
