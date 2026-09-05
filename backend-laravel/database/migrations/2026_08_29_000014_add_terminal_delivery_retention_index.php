<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement("CREATE INDEX idx_deliveries_failed_retention ON webhook_deliveries (created_at, id) WHERE status = 'failed'");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS idx_deliveries_failed_retention');
    }
};
