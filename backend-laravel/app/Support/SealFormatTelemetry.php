<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * Evidencia de formatos de sello en vuelo: la retirada del fallback legacy se
 * decide con datos observados, no con fechas recordadas a mano.
 *
 * Dos observaciones, ambas en `audit_events` (append-only):
 *
 *  - `crypto.legacy_seal_opened`: un sello del formato sin key-id se abrió o
 *    verificó DE VERDAD. Es la prueba positiva de que alguno seguía vivo en ese
 *    momento. Sólo se registra el ÉXITO del camino legacy, nunca un rechazo:
 *    una cookie de basura no puede llenar el registro ni cronometrar la ventana.
 *  - `crypto.seal_v2_first_issued`: la primera emisión del formato con key-id
 *    observada por este despliegue. Acota por arriba cuándo dejaron de emitirse
 *    sellos legacy (el arranque rodante puede alargarla unos minutos; el margen
 *    operativo del runbook lo cubre), y con el TTL más largo de las superficies
 *    cierra la ventana de retirada.
 *
 * La marca de primera emisión se escribe una sola vez: `Cache::add` atómico,
 * con fallo silencioso —si la caché no está, no hay marca y el comando acepta
 * `--since` como sustituto—. La telemetría nunca rompe un sellado ni una
 * verificación: todo lo que registra es mejor-que-nada.
 */
final class SealFormatTelemetry
{
    public const ACTION_LEGACY_OPENED = 'crypto.legacy_seal_opened';

    public const ACTION_V2_FIRST_ISSUED = 'crypto.seal_v2_first_issued';

    public const MARKER_CACHE_KEY = 'uvh:seal-format:v2-first-issued';

    /**
     * Un sello legacy abrió Y superó la validación semántica de su consumidor:
     * prueba de que seguía en vuelo y sirviendo. El consumidor emite después de
     * validar (expiración, patrón, parseo), nunca al descifrar: un sello
     * auténtico caducado no es evidencia de nada vivo. `$kind` nombra la
     * familia —`sealed` (opaco) o `signed` (firmado)—, no la superficie: el
     * que abre no sabe en qué cookie viajaba.
     */
    public static function legacyOpened(string $kind): void
    {
        try {
            Audit::write(null, self::ACTION_LEGACY_OPENED, 'seal', $kind);
        } catch (Throwable) {
            // Registrar evidencia nunca puede tumbar la operación que la motiva.
        }
    }

    /**
     * Marca la primera emisión v2 observada; el resto de emisiones no cuesta
     * nada más que el `Cache::add` (una llamada atómica) y sólo la primera
     * escribe fila.
     */
    public static function modernIssued(): void
    {
        try {
            if (Cache::add(self::MARKER_CACHE_KEY, 1, now()->addYears(10))) {
                Audit::write(null, self::ACTION_V2_FIRST_ISSUED, 'seal', 'v2');
            }
        } catch (Throwable) {
            // Sin caché no hay marca: el operador tiene `--since`.
        }
    }
}
