<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('registration_attempts', function (Blueprint $table): void {
            $table->bigIncrements('id');
            // A browser's requested destination, never evidence of an account.
            // Multiple browsers may request the same address independently.
            $table->string('email', 254);
            $table->integer('security_version')->default(1);
            $table->timestampTz('expires_at', 3)->index();
            $table->foreignId('pending_registration_id')->nullable()->unique()
                ->constrained('pending_registrations')->nullOnDelete();
            $table->integer('pending_security_version')->nullable();
            // Keep the old cookie's namespace after its pending row disappears.
            // This is private lineage, not a foreign key or account identity.
            $table->bigInteger('legacy_pending_id')->nullable()->unique();
            $table->integer('legacy_security_version')->nullable();
            $table->string('legacy_claim_hash', 64)->nullable()->unique();
            $table->timestampTz('legacy_consumed_at', 3)->nullable();
            $table->timestampsTz(3);
        });
        DB::statement('ALTER TABLE registration_attempts ADD CONSTRAINT registration_attempts_positive_generations CHECK (id > 0 AND security_version > 0 AND (pending_security_version IS NULL OR pending_security_version > 0) AND (legacy_security_version IS NULL OR legacy_security_version > 0) AND (legacy_pending_id IS NULL OR legacy_pending_id > 0) AND (pending_registration_id IS NULL OR pending_security_version IS NOT NULL))');
        DB::statement("ALTER TABLE registration_attempts ADD CONSTRAINT registration_attempts_legacy_hash CHECK (legacy_claim_hash IS NULL OR legacy_claim_hash ~ '^[a-f0-9]{64}$')");

        // Existing cookies name a pending row. Preserve a private lineage for
        // every such row; later mailbox activation must not expose its fate
        // by deleting this browser context. No password, name or consent moves.
        $createdAt = now();
        $expiresAt = $createdAt->copy()->addSeconds(max(60, (int) config('uvh.registration_edit_ttl_hours') * 3600));
        DB::table('pending_registrations')->orderBy('id')->chunkById(500, static function ($rows) use ($createdAt, $expiresAt): void {
            $batch = [];
            foreach ($rows as $row) {
                $batch[] = [
                    'email' => $row->email,
                    'security_version' => 1,
                    'expires_at' => $expiresAt->format('Y-m-d H:i:s.vP'),
                    'pending_registration_id' => $row->id,
                    'pending_security_version' => $row->security_version,
                    'legacy_pending_id' => $row->id,
                    'legacy_security_version' => $row->security_version,
                    'created_at' => $createdAt->format('Y-m-d H:i:s.vP'),
                    'updated_at' => $createdAt->format('Y-m-d H:i:s.vP'),
                ];
            }
            if ($batch !== []) {
                DB::table('registration_attempts')->insert($batch);
            }
        });
    }

    public function down(): void
    {
        if (DB::table('registration_attempts')->where('expires_at', '>', now())->exists()) {
            throw new RuntimeException('Cannot remove registration attempts while browser contexts are active. Let them expire before rolling back this schema.');
        }
        Schema::dropIfExists('registration_attempts');
    }
};
