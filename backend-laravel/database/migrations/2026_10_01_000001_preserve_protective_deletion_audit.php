<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('account_deletion_requests', function (Blueprint $table) {
            $table->boolean('cancellation_audit_pending')->default(false)->index();
        });
    }

    public function down(): void
    {
        Schema::table('account_deletion_requests', function (Blueprint $table) {
            $table->dropIndex(['cancellation_audit_pending']);
            $table->dropColumn('cancellation_audit_pending');
        });
    }
};
