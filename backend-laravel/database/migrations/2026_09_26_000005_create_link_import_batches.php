<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Lotes de importación CSV con estado por fila (F7-hotfix).
     *
     * La importación crea cada enlace en su propia transacción: un crash a
     * mitad de archivo dejaba enlaces parciales y un reintento volvía a pasar
     * por las filas ya aplicadas —el resultado final ya no reproducía la
     * intención original—. Con lote y estado por fila, cada creación compila
     * con su registro en `link_import_rows`, de modo que un reintento con la
     * misma `Idempotency-Key` REANUDA: las filas ya resueltas se reproducen
     * desde su registro y sólo se procesan las restantes.
     *
     * El lote se identifica por cuenta + workspace + clave de idempotencia: la
     * misma identidad que la intención de la petición. Vive lo que vive la
     * ventana de idempotencia (24 h) y se purga al usarse.
     */
    public function up(): void
    {
        Schema::create('link_import_batches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('workspace_id')->constrained('workspaces')->cascadeOnDelete();
            $table->string('idempotency_key', 64);
            $table->string('request_hash', 64);
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['user_id', 'workspace_id', 'idempotency_key']);
            $table->index('created_at');
        });

        Schema::create('link_import_rows', function (Blueprint $table) {
            $table->id();
            $table->foreignId('batch_id')->constrained('link_import_batches')->cascadeOnDelete();
            /** Fila del archivo: la cabecera es la 1. */
            $table->unsignedInteger('row_number');
            /**
             * `created` — el enlace se creó; `failed` — la fila era válida pero
             * la creación falló (alias, cuota); `rejected` — la validación la
             * rechazó. El reanudado reproduce exactamente este resultado.
             */
            $table->string('status', 16);
            $table->foreignId('created_link_id')->nullable()->constrained('links')->nullOnDelete();
            $table->text('error')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['batch_id', 'row_number']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('link_import_rows');
        Schema::dropIfExists('link_import_batches');
    }
};
