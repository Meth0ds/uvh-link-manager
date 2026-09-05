<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement("CREATE INDEX idx_domains_stale_verification ON custom_domains (updated_at, id) WHERE state = 'verifying'");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS idx_domains_stale_verification');
    }
};
