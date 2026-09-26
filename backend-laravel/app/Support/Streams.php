<?php

namespace App\Support;

/**
 * Escrituras streaming verificadas (fail-closed).
 *
 * `fwrite()` puede devolver `false`, escribir 0 bytes o escribir menos bytes de
 * los solicitados —disco lleno, I/O parcial, volumen con problemas—. Un
 * artefacto o documento que da por bueno lo que no llegó íntegro se declara
 * `ready` truncado, así que aquí ninguna escritura se da por buena: se itera
 * hasta completar y se lanza ante cualquier señal de fallo. `flush()` verifica
 * además que los bytes abandonen el buffer del proceso antes de publicar.
 */
final class Streams
{
    /**
     * Escribe exactamente `$data` en el stream o lanza. Nunca devuelve "a
     * medios": o quedaron todos los bytes o hay excepción.
     *
     * @param  resource  $stream
     */
    public static function writeAll($stream, string $data): void
    {
        $length = strlen($data);
        $offset = 0;
        while ($offset < $length) {
            $written = @fwrite($stream, substr($data, $offset));
            if ($written === false || $written === 0) {
                throw new \RuntimeException('No se pudo completar la escritura en stream');
            }
            $offset += $written;
        }
    }

    /**
     * Vuelca el buffer del stream al dispositivo y exige éxito.
     *
     * @param  resource  $stream
     */
    public static function flush($stream): void
    {
        if (! @fflush($stream)) {
            throw new \RuntimeException('No se pudo vaciar el stream');
        }
    }
}
