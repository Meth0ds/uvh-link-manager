<?php

use App\Support\Audit;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The self-service export flow retires the two mail-time bearers: the
     * confirmation token (generation is authorised by the step-up alone) and
     * the single-use download token (downloads are authorised by the session
     * plus a fresh step-up). The replacement is not a bearer: a mail generation
     * hash only lets the outbox decide whether a queued "ready" notice still
     * describes live state, so a cancelled export never announces itself.
     */
    public function up(): void
    {
        // Rows waiting for a confirmation link that no longer exists are
        // cancelled explicitly, with the reason in the audit trail: the owner
        // can always request a new export from the panel.
        $stale = DB::table('data_export_requests')->where('status', 'requested')->get(['id', 'user_id']);
        foreach ($stale as $row) {
            $updated = DB::table('data_export_requests')->where('id', $row->id)
                ->where('status', 'requested')
                ->update([
                    'status' => 'cancelled',
                    'confirmation_token_hash' => null,
                    'confirmation_expires_at' => null,
                    'updated_at' => now(),
                ]);
            if ($updated === 1) {
                Audit::write((int) $row->user_id, 'account.data_export_cancelled', 'data_export', (int) $row->id, [
                    'reason' => 'confirmation_retired',
                ]);
            }
        }

        Schema::table('data_export_requests', function (Blueprint $table) {
            $table->string('mail_generation_hash', 64)->nullable()->unique();
            $table->string('failure_reason', 32)->nullable();
        });

        // A queued ready notice references the old bearer hash as its
        // generation; carrying it over keeps those outbox rows comparable
        // instead of silently stale.
        DB::statement('UPDATE data_export_requests SET mail_generation_hash = download_token_hash WHERE download_token_hash IS NOT NULL');

        Schema::table('data_export_requests', function (Blueprint $table) {
            $table->dropColumn([
                'confirmation_token_hash',
                'confirmation_expires_at',
                'confirmed_at',
                'download_token_hash',
            ]);
        });

        DB::statement('ALTER TABLE data_export_requests DROP CONSTRAINT data_export_requests_status_check');
        DB::statement("ALTER TABLE data_export_requests ADD CONSTRAINT data_export_requests_status_check CHECK (status IN ('processing','ready','downloaded','failed','cancelled','expired'))");
        DB::statement('DROP INDEX data_export_requests_user_active_unique');
        DB::statement("CREATE UNIQUE INDEX data_export_requests_user_active_unique ON data_export_requests (user_id) WHERE status IN ('processing','ready')");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE data_export_requests DROP CONSTRAINT data_export_requests_status_check');
        DB::statement("ALTER TABLE data_export_requests ADD CONSTRAINT data_export_requests_status_check CHECK (status IN ('requested','processing','ready','downloaded','failed','cancelled','expired'))");
        DB::statement('DROP INDEX data_export_requests_user_active_unique');
        DB::statement("CREATE UNIQUE INDEX data_export_requests_user_active_unique ON data_export_requests (user_id) WHERE status IN ('requested','processing','ready')");

        Schema::table('data_export_requests', function (Blueprint $table) {
            $table->dropColumn(['mail_generation_hash', 'failure_reason']);
        });

        Schema::table('data_export_requests', function (Blueprint $table) {
            $table->string('confirmation_token_hash', 64)->nullable()->unique();
            $table->timestampTz('confirmation_expires_at')->nullable();
            $table->string('download_token_hash', 64)->nullable()->unique();
            $table->timestampTz('confirmed_at')->nullable();
        });
    }
};
