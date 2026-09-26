<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * La confirmación de descarga queda ligada a la sesión que la sirvió
     * (F7-hotfix).
     *
     * `download_served_at` probaba que la descarga se preparó, pero no para
     * QUIÉN: otra sesión de la misma cuenta podía invocar el ACK, consumir la
     * exportación y borrar un artifact que nunca se le entregó. Ahora el
     * endpoint de descarga registra la sesión que superó el step-up y sólo esa
     * sesión puede confirmar recepción.
     *
     * Las filas servidas antes de este despliegue quedan con el campo nulo y se
     * aceptan durante su ventana de 48 horas, para no varar descargas en curso.
     */
    public function up(): void
    {
        Schema::table('data_export_requests', function (Blueprint $table) {
            $table->string('download_served_session_id', 64)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('data_export_requests', function (Blueprint $table) {
            $table->dropColumn('download_served_session_id');
        });
    }
};
