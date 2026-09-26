<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Claves de idempotencia para las operaciones masivas (F7): una misma
     * petición repetida —un reintento del navegador, un doble clic, un proxy
     * que reenvía— se aplica una sola vez y las repeticiones reciben la
     * respuesta original.
     *
     * La fila pertenece a la cuenta que la usó y a un ámbito concreto
     * (`scope`), de modo que la misma clave en otra operación no colisiona. El
     * `request_hash` guarda la identidad del cuerpo: repetir la clave con otra
     * petición se rechaza en vez de devolverle una respuesta ajena.
     *
     * Mientras `response_status` siga nulo hay una operación en curso: una
     * repetición concurrente se rechaza (409) en vez de aplicarla dos veces.
     * Si la operación falla, la reserva se libera y la clave vuelve a ser
     * utilizable. Las filas caducan a las 24 horas y se purgan al usarse.
     */
    public function up(): void
    {
        Schema::create('idempotency_keys', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('scope', 64);
            $table->string('key', 64);
            $table->string('request_hash', 64);
            $table->json('response_body')->nullable();
            $table->unsignedSmallInteger('response_status')->nullable();
            $table->timestamp('expires_at');
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['user_id', 'scope', 'key']);
            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('idempotency_keys');
    }
};
