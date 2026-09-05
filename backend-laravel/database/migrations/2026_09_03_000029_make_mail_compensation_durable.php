<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE mail_outbox DROP CONSTRAINT mail_outbox_status_check');
        DB::statement("ALTER TABLE mail_outbox ADD CONSTRAINT mail_outbox_status_check CHECK (status IN ('pending','queued','processing','sent','failed','obsolete','comp_pending','compensating','compensated'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE mail_outbox DROP CONSTRAINT mail_outbox_status_check');
        DB::table('mail_outbox')->whereIn('status', ['comp_pending', 'compensating'])->update([
            'status' => 'failed',
            'locked_at' => null,
            'lock_token' => null,
            'last_error' => 'compensation_incomplete',
            'updated_at' => DB::raw('NOW()'),
        ]);
        DB::table('mail_outbox')->where('status', 'compensated')->update([
            'status' => 'obsolete',
            'last_error' => 'lifecycle_compensated',
            'updated_at' => DB::raw('NOW()'),
        ]);
        DB::statement("ALTER TABLE mail_outbox ADD CONSTRAINT mail_outbox_status_check CHECK (status IN ('pending','queued','processing','sent','failed','obsolete'))");
    }
};
