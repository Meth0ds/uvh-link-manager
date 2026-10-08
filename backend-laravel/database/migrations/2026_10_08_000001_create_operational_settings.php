<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Interruptores operativos globales (p. ej. pausa de registros).
     *
     * Clave/valor con auditoría de quién lo tocó: el flag vive en DB para
     * poder operarlo desde administración sin despliegue. La lectura se
     * cachea en `RegistrationGate`; la escritura invalida esa caché en el
     * mismo commit. Sin fila, el sistema arranca abierto (fail-open de la
     * lectura, nunca de la escritura).
     */
    public function up(): void
    {
        Schema::create('operational_settings', function (Blueprint $table): void {
            $table->string('key', 64)->primary();
            $table->boolean('value_bool')->default(false);
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz(3);
        });

        DB::table('operational_settings')->updateOrInsert(
            ['key' => 'registration_paused'],
            ['value_bool' => false, 'updated_at' => now()],
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('operational_settings');
    }
};
