<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('click_events', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('link_id')->constrained()->cascadeOnDelete();
            $table->timestampTz('occurred_at')->useCurrent();
            $table->string('country')->nullable();
            $table->string('device')->nullable();
            $table->string('browser')->nullable();
            $table->string('os')->nullable();
            $table->string('referrer_domain')->nullable();
            $table->string('campaign')->nullable();
            $table->string('visitor_hash')->nullable();
            $table->boolean('password_ok')->default(true);
        });

        Schema::create('metric_rollups', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('link_id')->constrained()->cascadeOnDelete();
            $table->string('day', 10);
            $table->integer('clicks')->default(0);
            $table->integer('visitors')->default(0);
            $table->jsonb('countries')->nullable();
            $table->jsonb('devices')->nullable();
            $table->jsonb('browsers')->nullable();
            $table->jsonb('os')->nullable();
            $table->jsonb('referrers')->nullable();
            $table->jsonb('campaigns')->nullable();
            $table->unique(['link_id', 'day']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('metric_rollups');
        Schema::dropIfExists('click_events');
    }
};
