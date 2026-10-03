<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('security_incident_audits', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            // The resource identity survives account removal, like audit_events.
            $table->bigInteger('affected_user_id');
            $table->boolean('administratively_blocked');
            $table->string('incident_correlation_id', 32)->nullable();
            $table->timestampTz('incident_at', 3);
        });
        DB::statement('ALTER TABLE security_incident_audits ADD CONSTRAINT security_incident_audits_positive_identity CHECK (id > 0 AND affected_user_id > 0 AND (user_id IS NULL OR user_id = affected_user_id))');
        DB::statement("ALTER TABLE security_incident_audits ADD CONSTRAINT security_incident_audits_trace_shape CHECK (incident_correlation_id IS NULL OR incident_correlation_id ~ '^[a-f0-9]{32}$')");
    }

    public function down(): void
    {
        if (DB::table('security_incident_audits')->exists()) {
            throw new RuntimeException('Cannot remove security incident audit receipts while recovery is pending. Reconcile them before rolling back this schema.');
        }
        Schema::dropIfExists('security_incident_audits');
    }
};
