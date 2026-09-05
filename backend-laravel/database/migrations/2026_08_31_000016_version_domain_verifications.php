<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('custom_domains', function (Blueprint $table) {
            // Every queued DNS check captures this generation. A delayed job
            // may only apply its result while the generation still matches.
            $table->unsignedBigInteger('verification_version')->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('custom_domains', function (Blueprint $table) {
            $table->dropColumn('verification_version');
        });
    }
};
