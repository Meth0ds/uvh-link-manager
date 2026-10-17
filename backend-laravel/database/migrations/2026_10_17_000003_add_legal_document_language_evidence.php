<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('legal_acceptances', function (Blueprint $table): void {
            // Leave historical evidence untouched: do not invent a presentation
            // language or document hash for an earlier recorded acceptance.
            $table->string('language', 2)->nullable();
            $table->char('document_sha256', 64)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('legal_acceptances', function (Blueprint $table): void {
            $table->dropColumn(['language', 'document_sha256']);
        });
    }
};
