<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Arriendo de ejecución para las claves de idempotencia (F7-hotfix).
     *
     * `expires_at` (24 h) es la ventana de REPLAY: cuánto tiempo una repetición
     * recibe la respuesta original. Es demasiado para la EJECUCIÓN: si el
     * proceso muere tras reservar y antes de sellar, la clave quedaba
     * «en curso» un día entero y atascaba una operación legítima.
     *
     * `lease_until` acota la ejecución (minutos): mientras el arriendo está
     * vivo, una repetición concurrente recibe 409; pasado, una nueva petición
     * puede tomar la reserva abandonada y reintentar. `lease_token` identifica
     * la reserva concreta: el sellado y la liberación de un intento viejo
     * jamás tocan la reserva de un intento posterior (takeover seguro).
     */
    public function up(): void
    {
        Schema::table('idempotency_keys', function (Blueprint $table) {
            $table->timestamp('lease_until')->nullable();
            $table->string('lease_token', 64)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('idempotency_keys', function (Blueprint $table) {
            $table->dropColumn(['lease_until', 'lease_token']);
        });
    }
};
