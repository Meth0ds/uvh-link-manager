<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // ISO input admits six fractional digits. Keep the requested instant
        // instead of activating or expiring a link at a rounded second.
        DB::statement('ALTER TABLE links ALTER COLUMN scheduled_at TYPE timestamp(6) with time zone, ALTER COLUMN expires_at TYPE timestamp(6) with time zone');
    }

    public function down(): void
    {
        DB::transaction(function (): void {
            DB::statement('LOCK TABLE links IN ACCESS EXCLUSIVE MODE');
            if (DB::table('links')->whereRaw("scheduled_at <> date_trunc('second', scheduled_at) OR expires_at <> date_trunc('second', expires_at)")->exists()) {
                throw new RuntimeException('Cannot reduce link lifecycle precision while fractional instants exist');
            }
            DB::statement('ALTER TABLE links ALTER COLUMN scheduled_at TYPE timestamp(0) with time zone, ALTER COLUMN expires_at TYPE timestamp(0) with time zone');
        });
    }
};
