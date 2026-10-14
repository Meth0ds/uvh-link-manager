<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('link_versions', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->foreignId('link_id')->constrained('links')->cascadeOnDelete();
            $table->unsignedInteger('revision');
            $table->unsignedInteger('link_version');
            $table->foreignId('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('source', 24);
            $table->jsonb('configuration');
            $table->string('configuration_hash', 64);
            $table->jsonb('changed_fields')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->unique(['link_id', 'revision']);
            $table->index(['link_id', 'revision']);
            $table->index(['workspace_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('link_versions');
    }
};
