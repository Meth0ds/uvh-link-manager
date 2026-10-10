<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('qr_creation_receipts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->string('scope', 16);
            $table->uuid('request_key');
            $table->char('request_hash', 64);
            // Deliberately not a resource FK: replaying a deleted creation must
            // report its deletion, rather than silently create it again.
            $table->unsignedBigInteger('resource_id');
            $table->timestampsTz();
            $table->unique(['workspace_id', 'scope', 'request_key']);
        });
        foreach (['qr_designs', 'qr_variants'] as $table) {
            DB::table('qr_creation_receipts')->insertUsing(
                ['workspace_id', 'scope', 'request_key', 'request_hash', 'resource_id', 'created_at', 'updated_at'],
                DB::table($table)->select(['workspace_id', DB::raw("'{$table}'"), 'request_key', 'request_hash', 'id', 'created_at', 'updated_at'])
            );
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('qr_creation_receipts');
    }
};
