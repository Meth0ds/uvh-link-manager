<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // The public ISO parser accepts six fractional digits. PostgreSQL's
        // original timestamp(0) rounds them, sometimes extending authority.
        DB::statement('ALTER TABLE api_tokens ALTER COLUMN expires_at TYPE timestamp(6) with time zone');
    }

    public function down(): void
    {
        // Reverting precision could silently extend a credential's deadline or
        // erase its history. Refuse until fractional rows are handled explicitly.
        DB::transaction(function (): void {
            DB::statement('LOCK TABLE api_tokens IN ACCESS EXCLUSIVE MODE');
            if (DB::table('api_tokens')->whereRaw("expires_at <> date_trunc('second', expires_at)")->exists()) {
                throw new RuntimeException('Cannot reduce API token expiry precision while fractional deadlines exist');
            }
            DB::statement('ALTER TABLE api_tokens ALTER COLUMN expires_at TYPE timestamp(0) with time zone');
        });
    }
};
