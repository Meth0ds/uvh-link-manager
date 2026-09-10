<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('click_events', function (Blueprint $table) {
            // Historical synchronous rows remain valid with NULL. Every new
            // queued event carries a UUID so at-least-once delivery is safe.
            $table->uuid('event_id')->nullable()->unique();
        });
    }

    public function down(): void
    {
        Schema::table('click_events', function (Blueprint $table) {
            $table->dropUnique(['event_id']);
            $table->dropColumn('event_id');
        });
    }
};
