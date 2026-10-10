<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('qr_asset_cleanup_receipts', function (Blueprint $table) {
            // No account/workspace FK: cleanup must survive cascading erasure.
            $table->string('path', 180)->primary();
            $table->timestampTz('available_at')->index();
            $table->timestampTz('expires_at');
        });
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION uvh_qr_asset_cleanup_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                INSERT INTO qr_asset_cleanup_receipts(path, available_at, expires_at)
                VALUES (OLD.path, date_trunc('second', CURRENT_TIMESTAMP), date_trunc('second', CURRENT_TIMESTAMP) + INTERVAL '1 day')
                ON CONFLICT(path) DO UPDATE SET available_at = date_trunc('second', CURRENT_TIMESTAMP),
                    expires_at = date_trunc('second', CURRENT_TIMESTAMP) + INTERVAL '1 day';
                RETURN OLD;
            END;
            $$;
            CREATE TRIGGER uvh_qr_asset_cleanup_before_delete
                BEFORE DELETE ON qr_assets FOR EACH ROW EXECUTE FUNCTION uvh_qr_asset_cleanup_receipt();
            SQL);
    }

    public function down(): void
    {
        DB::unprepared('DROP TRIGGER IF EXISTS uvh_qr_asset_cleanup_before_delete ON qr_assets; DROP FUNCTION IF EXISTS uvh_qr_asset_cleanup_receipt();');
        Schema::dropIfExists('qr_asset_cleanup_receipts');
    }
};
