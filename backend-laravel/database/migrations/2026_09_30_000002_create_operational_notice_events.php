<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('operational_notice_events', function (Blueprint $table) {
            $table->string('kind', 64);
            $table->unsignedBigInteger('resource_id');
            $table->string('generation', 128);
            $table->timestampTz('created_at')->useCurrent();
            $table->primary(['kind', 'resource_id', 'generation']);
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('operational_notice_events');
    }
};
