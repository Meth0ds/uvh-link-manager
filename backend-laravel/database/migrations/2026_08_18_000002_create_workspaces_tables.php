<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('workspaces', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('name');
            $table->string('slug')->unique();
            $table->foreignId('owner_user_id')->constrained('users');
            $table->timestampsTz();
        });

        Schema::create('memberships', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('role');
            $table->timestampTz('created_at')->useCurrent();
            $table->unique(['workspace_id', 'user_id']);
        });
        DB::statement("ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('owner','admin','editor','viewer'))");

        Schema::create('invitations', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->string('email');
            $table->string('role');
            $table->string('token', 64)->unique();
            $table->foreignId('invited_by')->constrained('users');
            $table->string('status')->default('pending');
            $table->timestampTz('expires_at');
            $table->timestampTz('created_at')->useCurrent();
        });
        DB::statement("ALTER TABLE invitations ADD CONSTRAINT invitations_role_check CHECK (role IN ('admin','editor','viewer'))");
        DB::statement("ALTER TABLE invitations ADD CONSTRAINT invitations_status_check CHECK (status IN ('pending','accepted','rejected','cancelled','expired'))");

        Schema::create('quotas', function (Blueprint $table) {
            $table->unsignedBigInteger('workspace_id');
            $table->primary('workspace_id');
            $table->foreign('workspace_id')->references('id')->on('workspaces')->cascadeOnDelete();
            $table->integer('links_limit')->default(1000);
            $table->timestampTz('updated_at')->useCurrent();
        });

        // Moved before `links` because links.domain_id references this table.
        Schema::create('custom_domains', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('workspace_id')->constrained()->cascadeOnDelete();
            $table->string('domain');
            $table->string('verification_token');
            $table->string('state')->default('pending');
            $table->timestampTz('verified_at')->nullable();
            $table->timestampsTz();
        });
        DB::statement("ALTER TABLE custom_domains ADD CONSTRAINT custom_domains_state_check CHECK (state IN ('pending','verifying','verified','active','error','disabled'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('custom_domains');
        Schema::dropIfExists('quotas');
        Schema::dropIfExists('invitations');
        Schema::dropIfExists('memberships');
        Schema::dropIfExists('workspaces');
    }
};
