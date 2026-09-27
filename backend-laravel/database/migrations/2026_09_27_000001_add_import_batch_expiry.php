<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('link_import_batches', function (Blueprint $table) {
            $table->timestamp('expires_at')->nullable()->default(DB::raw("CURRENT_TIMESTAMP + INTERVAL '24 hours'"))->index();
        });
        DB::statement("UPDATE link_import_batches SET expires_at = created_at + INTERVAL '24 hours'");
        DB::statement('ALTER TABLE link_import_batches ALTER COLUMN expires_at SET NOT NULL');
    }

    public function down(): void
    {
        Schema::table('link_import_batches', function (Blueprint $table) {
            $table->dropColumn('expires_at');
        });
    }
};
