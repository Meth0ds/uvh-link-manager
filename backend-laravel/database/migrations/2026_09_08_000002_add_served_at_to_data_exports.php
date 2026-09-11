<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('data_export_requests', function (Blueprint $table) {
            // Distinguish server-side response preparation from the later
            // client acknowledgement that consumes the bearer.
            $table->timestampTz('download_served_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('data_export_requests', function (Blueprint $table) {
            $table->dropColumn('download_served_at');
        });
    }
};
