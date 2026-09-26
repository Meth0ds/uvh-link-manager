<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * La etapa de generación que el panel muestra mientras la exportación
     * corre: `collecting | analytics | encoding | encrypting | finalizing`.
     *
     * Es progreso visible, nunca autoridad: la autoridad sigue siendo `status`.
     * Sólo tiene sentido sobre una fila `processing`; al terminar —bien o
     * mal— se limpia, porque una etapa vieja junto a un estado terminal
     * contaría una historia que ya no es cierta.
     */
    public function up(): void
    {
        Schema::table('data_export_requests', function (Blueprint $table) {
            $table->string('stage', 20)->nullable()->after('status');
        });
        DB::statement(
            'ALTER TABLE data_export_requests ADD CONSTRAINT data_export_requests_stage_check '
            ."CHECK (stage IS NULL OR stage IN ('collecting','analytics','encoding','encrypting','finalizing'))"
        );
    }

    public function down(): void
    {
        // Reversible: la etapa es efímera y se deriva de lo que el job hace, no
        // un dato que la reversión vaya a perder para siempre.
        DB::statement('ALTER TABLE data_export_requests DROP CONSTRAINT IF EXISTS data_export_requests_stage_check');
        Schema::table('data_export_requests', function (Blueprint $table) {
            $table->dropColumn('stage');
        });
    }
};
