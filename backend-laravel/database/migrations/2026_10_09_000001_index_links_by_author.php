<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    // PostgreSQL concurrent index builds/drops cannot run in a transaction.
    public $withinTransaction = false;

    public function up(): void
    {
        // Both admin live-link counts and account exports use created_by.
        // Keep deleted links in the index: exports include their history.
        DB::statement('CREATE INDEX CONCURRENTLY links_created_by_id_index ON links (created_by, id)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX CONCURRENTLY IF EXISTS links_created_by_id_index');
    }
};
