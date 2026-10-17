<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', fn (Blueprint $table) => $table->string('language', 2)->nullable());
        Schema::table('pending_registrations', fn (Blueprint $table) => $table->string('language', 2)->nullable());
    }

    public function down(): void
    {
        Schema::table('pending_registrations', fn (Blueprint $table) => $table->dropColumn('language'));
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn('language'));
    }
};
