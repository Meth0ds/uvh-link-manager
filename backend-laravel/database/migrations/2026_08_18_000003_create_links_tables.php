<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('links', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->constrained('users');
            $table->foreignId('domain_id')->nullable()->constrained('custom_domains')->nullOnDelete();
            $table->string('alias');
            $table->text('destination');
            $table->text('fallback_destination')->nullable();
            $table->string('state')->default('active');
            $table->string('password_hash')->nullable();
            $table->bigInteger('max_clicks')->nullable();
            $table->bigInteger('click_count')->default(0);
            $table->boolean('single_use')->default(false);
            $table->timestampTz('used_at')->nullable();
            $table->timestampTz('scheduled_at')->nullable();
            $table->timestampTz('expires_at')->nullable();
            $table->text('notes')->nullable();
            $table->string('utm_source')->nullable();
            $table->string('utm_medium')->nullable();
            $table->string('utm_campaign')->nullable();
            $table->string('utm_term')->nullable();
            $table->string('utm_content')->nullable();
            $table->timestampsTz();
            $table->timestampTz('deleted_at')->nullable();
        });
        DB::statement("ALTER TABLE links ADD CONSTRAINT links_state_check CHECK (state IN ('scheduled','active','paused','expired','blocked','archived','deleted'))");

        Schema::create('tags', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->string('name');
        });

        Schema::create('link_tags', function (Blueprint $table) {
            $table->foreignId('link_id')->constrained()->cascadeOnDelete();
            $table->foreignId('tag_id')->constrained()->cascadeOnDelete();
            $table->primary(['link_id', 'tag_id']);
        });

        Schema::create('redirect_rules', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('link_id')->constrained()->cascadeOnDelete();
            $table->integer('priority')->default(0);
            $table->string('country')->nullable();
            $table->string('language')->nullable();
            $table->string('device')->nullable();
            $table->string('os')->nullable();
            $table->string('time_from')->nullable();
            $table->string('time_to')->nullable();
            $table->string('referrer')->nullable();
            $table->string('campaign')->nullable();
            $table->text('destination');
            $table->timestampTz('created_at')->useCurrent();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('redirect_rules');
        Schema::dropIfExists('link_tags');
        Schema::dropIfExists('tags');
        Schema::dropIfExists('links');
    }
};
