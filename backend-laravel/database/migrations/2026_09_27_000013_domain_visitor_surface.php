<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The visitor-facing behaviour of a custom domain is a closed set:
 *
 *  - `platform` (default): unknown paths get the platform's notice page.
 *  - `redirect`: unknown paths are forwarded to `root_destination`, keeping
 *    every stray visit on the brand the domain carries.
 *  - `branded`: unknown paths get a notice page that names the domain instead
 *    of the platform behind it.
 *
 * Constrained here rather than only in the controller so a future write path
 * cannot invent a mode the redirect surface does not know how to serve.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            ALTER TABLE custom_domains ADD CONSTRAINT custom_domains_not_found_mode_check
            CHECK (not_found_mode IS NULL OR not_found_mode IN ('platform', 'redirect', 'branded'))
            SQL);
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE custom_domains DROP CONSTRAINT IF EXISTS custom_domains_not_found_mode_check');
    }
};
