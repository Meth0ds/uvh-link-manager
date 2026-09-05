<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // An extension is a single coherent fact: deadline and approved reason
        // must appear together, and the new deadline must actually be later.
        DB::statement(<<<'SQL'
            ALTER TABLE privacy_rights_requests
            ADD CONSTRAINT privacy_rights_extension_consistency_check CHECK (
                (extended_until IS NULL AND extension_reason_code IS NULL)
                OR
                (extended_until IS NOT NULL AND extension_reason_code IS NOT NULL AND extended_until > due_at)
            )
        SQL);

        // A system note is deliberately unattributed. Human messages must keep
        // an actor reference while that account exists; ON DELETE SET NULL may
        // later remove it, so terminal historical rows remain valid.
        DB::statement(<<<'SQL'
            ALTER TABLE privacy_rights_messages
            ADD CONSTRAINT privacy_rights_system_author_check CHECK (
                author_role <> 'system' OR author_user_id IS NULL
            )
        SQL);
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE privacy_rights_messages DROP CONSTRAINT IF EXISTS privacy_rights_system_author_check');
        DB::statement('ALTER TABLE privacy_rights_requests DROP CONSTRAINT IF EXISTS privacy_rights_extension_consistency_check');
    }
};
