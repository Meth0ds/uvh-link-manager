<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Estado de presentación de la guía de inicio, por (usuario, workspace):
     * exactamente el alcance de la fila de membresía. Hasta ahora vivía en
     * `localStorage`, donde cada navegador guardaba su propia copia y el cierre
     * de la guía se perdía al cambiar de equipo. Es sólo una preferencia de
     * presentación —nunca progreso, hechos ni credenciales—, por eso una
     * columna nullable y sin más infraestructura.
     */
    public function up(): void
    {
        Schema::table('memberships', function (Blueprint $table) {
            $table->timestampTz('onboarding_dismissed_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('memberships', function (Blueprint $table) {
            $table->dropColumn('onboarding_dismissed_at');
        });
    }
};
