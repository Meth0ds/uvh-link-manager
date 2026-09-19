<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Marks the blocks the platform applied by itself.
     *
     * `state = blocked` alone cannot tell a machine decision from a moderator's,
     * and that difference is what decides whether a block may ever be withdrawn
     * automatically. Without it, removing a denylist entry left the links it had
     * blocked blocked forever: the entry stopped matching, and nothing revisited
     * them, because a blocked link was not eligible for re-analysis. The entry
     * looked temporary and was permanent.
     *
     * All three columns are nullable and carry no default, so adding them is a
     * catalogue-only change on the hottest table in the schema. `prior_state` is
     * stored rather than derived: a block that lands on a paused or scheduled
     * link must give that state back, not "active".
     */
    public function up(): void
    {
        Schema::table('links', function (Blueprint $table) {
            $table->timestamp('reputation_blocked_at')->nullable();
            $table->string('reputation_block_source', 16)->nullable();
            $table->string('reputation_block_prior_state', 16)->nullable();
        });

        // Partial: the marker is present on a handful of rows and absent on
        // almost every one, and every release query filters on exactly this.
        DB::statement('CREATE INDEX links_reputation_blocked_index ON links (reputation_blocked_at) WHERE reputation_blocked_at IS NOT NULL');
        DB::statement("ALTER TABLE links ADD CONSTRAINT links_reputation_block_source_check CHECK (reputation_block_source IN ('denylist','provider'))");
        DB::statement("ALTER TABLE links ADD CONSTRAINT links_reputation_block_prior_state_check CHECK (reputation_block_prior_state IN ('active','paused','scheduled','expired'))");
        // A half-written marker would be a block that can never be released or
        // one that could release a human decision. Neither is allowed to exist.
        DB::statement(
            'ALTER TABLE links ADD CONSTRAINT links_reputation_block_consistent_check CHECK ('
            .'(reputation_blocked_at IS NULL AND reputation_block_source IS NULL AND reputation_block_prior_state IS NULL)'
            .' OR (reputation_blocked_at IS NOT NULL AND reputation_block_source IS NOT NULL AND reputation_block_prior_state IS NOT NULL)'
            .')'
        );
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE links DROP CONSTRAINT IF EXISTS links_reputation_block_consistent_check');
        DB::statement('ALTER TABLE links DROP CONSTRAINT IF EXISTS links_reputation_block_prior_state_check');
        DB::statement('ALTER TABLE links DROP CONSTRAINT IF EXISTS links_reputation_block_source_check');
        DB::statement('DROP INDEX IF EXISTS links_reputation_blocked_index');
        Schema::table('links', function (Blueprint $table) {
            $table->dropColumn(['reputation_blocked_at', 'reputation_block_source', 'reputation_block_prior_state']);
        });
    }
};
