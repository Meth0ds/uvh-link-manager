<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Colecciones de un nivel y plantillas de enlace (F7).
     *
     * Una `collection` agrupa enlaces del workspace sin anidamiento: no hay
     * padre, sólo un nombre. Borrar la colección no borra enlaces: quedan sin
     * agrupar (`links.collection_id` se pone a NULL).
     *
     * Un `link_template` guarda los valores por defecto de un enlace —destino,
     * notas, UTM, etiquetas, límites— nunca un alias: el alias identifica un
     * enlace concreto y copiarlo chocaría al instante. El `payload` sólo puede
     * contener campos del contrato de enlace; se valida con las mismas reglas
     * al guardar la plantilla.
     *
     * Los nombres son únicos por workspace sin distinguir mayúsculas: el
     * índice usa `lower(name)` para que «Marketing» y «marketing» no sean dos
     * grupos distintos.
     */
    public function up(): void
    {
        Schema::create('collections', function (Blueprint $table) {
            $table->id();
            $table->foreignId('workspace_id')->constrained('workspaces')->cascadeOnDelete();
            $table->string('name', 60);
        });
        DB::statement('CREATE UNIQUE INDEX collections_workspace_name_unique ON collections (workspace_id, lower(name))');

        Schema::create('link_templates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('workspace_id')->constrained('workspaces')->cascadeOnDelete();
            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();
            $table->string('name', 60);
            $table->json('payload');
            $table->timestamp('created_at')->useCurrent();
        });
        DB::statement('CREATE UNIQUE INDEX link_templates_workspace_name_unique ON link_templates (workspace_id, lower(name))');

        Schema::table('links', function (Blueprint $table) {
            $table->foreignId('collection_id')->nullable()->after('domain_id')
                ->constrained('collections')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('links', function (Blueprint $table) {
            $table->dropConstrainedForeignId('collection_id');
        });
        Schema::dropIfExists('link_templates');
        Schema::dropIfExists('collections');
    }
};
