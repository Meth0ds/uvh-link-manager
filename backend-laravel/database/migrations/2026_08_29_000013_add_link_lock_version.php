<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('links', function (Blueprint $table) {
            // PostgreSQL timestamps in this schema have second precision, so
            // updated_at cannot safely serve as an optimistic-lock token.
            $table->unsignedBigInteger('version')->default(1)->after('password_version');
        });
    }

    public function down(): void
    {
        Schema::table('links', function (Blueprint $table) {
            $table->dropColumn('version');
        });
    }
};
