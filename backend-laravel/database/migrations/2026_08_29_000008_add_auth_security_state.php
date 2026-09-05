<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Incremented whenever credentials or the MFA posture changes.
            // It invalidates pre-authentication challenges and stale sessions.
            $table->unsignedInteger('security_version')->default(1);
            $table->text('mfa_pending_secret')->nullable();
            $table->timestampTz('mfa_pending_expires_at')->nullable();
        });

        Schema::table('sessions', function (Blueprint $table) {
            $table->unsignedInteger('security_version')->default(1);
            $table->timestampTz('mfa_verified_at')->nullable();
            $table->index(['user_id', 'security_version'], 'idx_sessions_user_security_version');
        });
    }

    public function down(): void
    {
        Schema::table('sessions', function (Blueprint $table) {
            $table->dropIndex('idx_sessions_user_security_version');
            $table->dropColumn(['security_version', 'mfa_verified_at']);
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['security_version', 'mfa_pending_secret', 'mfa_pending_expires_at']);
        });
    }
};
