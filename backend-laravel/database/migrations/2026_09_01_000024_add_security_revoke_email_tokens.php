<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE email_tokens DROP CONSTRAINT email_tokens_kind_check');
        DB::statement("ALTER TABLE email_tokens ADD CONSTRAINT email_tokens_kind_check CHECK (kind IN ('verify','reset','mfa_recovery','security_revoke'))");
    }

    public function down(): void
    {
        DB::table('email_tokens')->where('kind', 'security_revoke')->delete();
        DB::statement('ALTER TABLE email_tokens DROP CONSTRAINT email_tokens_kind_check');
        DB::statement("ALTER TABLE email_tokens ADD CONSTRAINT email_tokens_kind_check CHECK (kind IN ('verify','reset','mfa_recovery'))");
    }
};
