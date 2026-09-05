<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('links', function (Blueprint $table) {
            // Rotated whenever protection changes; signed unlock cookies bind
            // to this value and cannot outlive a password update/removal.
            $table->unsignedInteger('password_version')->default(0)->after('password_hash');
        });

        Schema::create('metric_unique_visitors', function (Blueprint $table) {
            $table->foreignId('link_id')->constrained()->cascadeOnDelete();
            $table->string('day', 10);
            $table->string('visitor_hash', 64);
            $table->primary(['link_id', 'day', 'visitor_hash']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('metric_unique_visitors');
        Schema::table('links', function (Blueprint $table) {
            $table->dropColumn('password_version');
        });
    }
};
