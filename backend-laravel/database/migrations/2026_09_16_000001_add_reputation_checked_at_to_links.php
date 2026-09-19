<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Cursor for the background re-analysis sweep.
     *
     * `staleLinkIds()` selected candidates by `updated_at` and kept the oldest
     * `limit * 4`, then discarded the ones whose verdict was still fresh.
     * Re-analysing a link does not touch `updated_at` — neither a check nor a
     * verdict does — so the same rows came back on every tick. Once that window
     * was full of links with fresh verdicts, a link beyond it whose verdict had
     * expired was never examined again, and nothing said so: the sweep quietly
     * stopped covering a growing tail of the table, which is the part of the
     * protection that exists for links nobody edits.
     *
     * This column is what the sweep orders by, so each tick starts after the
     * previous one instead of at the same place, and `NULLS FIRST` puts the rows
     * that have never been examined at the head of the queue. It records when a
     * link was last *looked at*, not the age of its verdict — the verdict's own
     * expiry stays in `destination_reputation_checks`, where it belongs.
     *
     * On a production table that already holds history, create the index with
     * `CONCURRENTLY` before deploying: `links` is on the redirect path's write
     * side, and a plain `CREATE INDEX` takes a write lock. The statements are
     * idempotent, so this migration is then a no-op for the index and a
     * catalogue-only change for the column.
     */
    public function up(): void
    {
        Schema::table('links', function (Blueprint $table) {
            $table->timestamp('reputation_checked_at')->nullable();
        });

        DB::statement('CREATE INDEX IF NOT EXISTS links_reputation_checked_index ON links (reputation_checked_at)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS links_reputation_checked_index');
        Schema::table('links', function (Blueprint $table) {
            $table->dropColumn('reputation_checked_at');
        });
    }
};
