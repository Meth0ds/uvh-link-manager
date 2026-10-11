<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('links', function (Blueprint $table): void {
            $table->string('name', 120)->nullable();
        });
        DB::statement('CREATE INDEX links_workspace_name_index ON links (workspace_id, lower(COALESCE(name, alias)), id) WHERE deleted_at IS NULL');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS links_workspace_name_index');
        Schema::table('links', function (Blueprint $table): void {
            $table->dropColumn('name');
        });
    }
};
