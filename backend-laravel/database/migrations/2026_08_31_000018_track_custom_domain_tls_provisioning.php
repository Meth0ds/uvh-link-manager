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
            $table->unsignedBigInteger('tls_version')->default(0);
            $table->timestampTz('tls_ready_at')->nullable();
            $table->string('tls_error', 64)->nullable();
        });

        DB::statement('ALTER TABLE custom_domains DROP CONSTRAINT custom_domains_state_check');
        DB::statement("ALTER TABLE custom_domains ADD CONSTRAINT custom_domains_state_check CHECK (state IN ('pending','verifying','verified','provisioning','active','error','disabled'))");
        DB::statement("CREATE INDEX idx_domains_stale_tls_provisioning ON custom_domains (updated_at, id) WHERE state = 'provisioning'");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS idx_domains_stale_tls_provisioning');
        DB::statement("UPDATE custom_domains SET state = 'verified', edge_eligible = false WHERE state = 'provisioning'");
        DB::statement('ALTER TABLE custom_domains DROP CONSTRAINT custom_domains_state_check');
        DB::statement("ALTER TABLE custom_domains ADD CONSTRAINT custom_domains_state_check CHECK (state IN ('pending','verifying','verified','active','error','disabled'))");

        Schema::table('custom_domains', function (Blueprint $table) {
            $table->dropColumn(['tls_version', 'tls_ready_at', 'tls_error']);
        });
    }
};
