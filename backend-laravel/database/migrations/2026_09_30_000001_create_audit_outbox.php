<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('audit_outbox', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->jsonb('event');
            $table->timestampTz('created_at')->useCurrent();
        });
    }

    public function down(): void
    {
        // Never silently discard committed security events during rollback.
        if (DB::table('audit_outbox')->exists()) {
            throw new RuntimeException('Drain audit_outbox before rolling back this migration');
        }
        Schema::dropIfExists('audit_outbox');
    }
};
