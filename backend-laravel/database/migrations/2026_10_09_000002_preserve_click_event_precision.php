<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // A timestamp(0) rounds clicks across range and UTC-day boundaries.
        // Existing rounded instants remain unchanged; new writes retain precision.
        DB::statement('ALTER TABLE click_events ALTER COLUMN occurred_at TYPE timestamp(6) with time zone');
    }

    public function down(): void
    {
        DB::transaction(function (): void {
            DB::statement('LOCK TABLE click_events IN ACCESS EXCLUSIVE MODE');
            if (DB::table('click_events')->whereRaw("occurred_at <> date_trunc('second', occurred_at)")->exists()) {
                throw new RuntimeException('Cannot reduce click event precision while fractional instants exist');
            }
            DB::statement('ALTER TABLE click_events ALTER COLUMN occurred_at TYPE timestamp(0) with time zone');
        });
    }
};
