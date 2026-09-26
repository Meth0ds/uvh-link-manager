<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Centro de notificaciones: bandeja durable, deduplicada y paginada de
     * avisos de seguridad y operativos, junto a las preferencias que separan
     * los obligatorios (nunca configurables) de los operativos (Inmediato /
     * Resumen diario / Solo UVH / Desactivado).
     *
     * La fila guarda sólo identidad y texto ya seguro: nunca secretos, URLs
     * bearer ni contenido de correo. `subject` es el nombre visible capturado
     * en el momento del evento (un workspace, el alias de un enlace), no un
     * volcado del recurso; `route` es la ruta interna del panel donde se
     * resuelve el asunto, jamás una URL absoluta con credenciales.
     *
     * `dedupe_key` es la identidad lógica del evento dentro de una cuenta: los
     * productores que se repiten (barridos, reintentos) pasan la misma clave y
     * la fila se registra una sola vez; los eventos sin identidad natural la
     * dejan nula y cada uno es una fila propia. El índice único es parcial
     * porque los nulos no son duplicados entre sí.
     *
     * `digested_at` marca cuándo dejó de estar pendiente de resumen diario:
     * se sella al registrarse para todo lo que no es candidato a resumen y al
     * incluirse en uno, de modo que el comando de resumen mira sólo lo nulo.
     */
    public function up(): void
    {
        Schema::create('notifications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('workspace_id')->nullable()->constrained('workspaces')->nullOnDelete();
            $table->string('kind', 64);
            $table->string('subject', 120)->nullable();
            $table->string('dedupe_key', 160)->nullable();
            $table->string('route', 160)->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->timestamp('read_at')->nullable();
            $table->timestamp('digested_at')->nullable();
            $table->index(['user_id', 'read_at']);
            $table->index(['user_id', 'id']);
        });
        DB::statement(
            'CREATE UNIQUE INDEX notifications_user_dedupe_unique '
            .'ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL'
        );

        Schema::create('notification_preferences', function (Blueprint $table) {
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('kind', 64);
            $table->string('delivery', 20);
            $table->timestamp('updated_at')->useCurrent();
            $table->primary(['user_id', 'kind']);
        });
        DB::statement(
            'ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_delivery_check '
            ."CHECK (delivery IN ('immediate','daily_digest','in_app_only','disabled'))"
        );
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_delivery_check');
        Schema::dropIfExists('notification_preferences');
        Schema::dropIfExists('notifications');
    }
};
