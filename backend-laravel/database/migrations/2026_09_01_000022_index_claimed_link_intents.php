<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('link_intent_claims', function (Blueprint $table) {
            // This table is only a revocation index. It never stores the raw
            // bearer or destination URL; the destination remains in cache.
            $table->string('intent_hash', 64)->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestampTz('expires_at');
            $table->timestampTz('created_at')->useCurrent();
            $table->index(['user_id', 'expires_at'], 'link_intent_claims_user_expiry_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('link_intent_claims');
    }
};
