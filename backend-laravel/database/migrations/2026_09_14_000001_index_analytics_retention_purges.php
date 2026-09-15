<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Both analytics tables are purged by a date predicate that no existing key
     * could serve: `metric_rollups` is keyed by `(link_id, day)` and
     * `metric_unique_visitors` by `(link_id, day, visitor_hash)`, so `day` is
     * never the leading column and every `WHERE day < ?` sweep visits the whole
     * table — once a minute, on the same tables the click path writes.
     *
     * On a production table that already holds history, create both indexes
     * with `CONCURRENTLY` before deploying: a plain `CREATE INDEX` takes a
     * write lock, and analytics writes are the ones being protected here. The
     * statements are idempotent, so this migration is then a no-op.
     */
    public function up(): void
    {
        DB::statement('CREATE INDEX IF NOT EXISTS metric_rollups_day_index ON metric_rollups (day)');
        DB::statement('CREATE INDEX IF NOT EXISTS metric_unique_visitors_day_index ON metric_unique_visitors (day)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS metric_unique_visitors_day_index');
        DB::statement('DROP INDEX IF EXISTS metric_rollups_day_index');
    }
};
