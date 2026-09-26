<?php

namespace App\Support;

use Illuminate\Support\Facades\Storage;

/**
 * El artefacto privado: contenedor cifrado en reposo de un documento que puede
 * ser mucho más grande que la memoria del proceso.
 *
 * Formato por bloques (`uvh-private-artifact-v2`), una línea por bloque:
 *
 * ```
 * uvh-private-artifact-v2
 * enc:v1:<base64url(iv|tag|cipher del bloque 1)>
 * enc:v1:<base64url(iv|tag|cipher del bloque 2)>
 * ```
 *
 * Cada bloque es un `UvhCrypto::encryptAtRest` completo —su propio IV y su
 * propia tag—, así que la autenticación es por bloque y la corrupción se
 * detecta en el bloque exacto que la sufre. La memoria viva es la de un bloque
 * (4 MiB de texto plano), tanto al escribir como al leer ni al recifrar.
 *
 * El formato legado —un solo blob `enc:v1:...` sin saltos de línea— sigue
 * abriéndose y recifrando: los artefactos viven 48 horas y la ventana de
 * rotación puede cruzarse con los emitidos por el formato anterior.
 *
 * Reglas que el lector impone y no negocia:
 *
 *  - una línea de bloque sin prefijo de ciphertext NO se acepta como texto
 *    plano: `decryptAtRest` tolera el texto heredado para columnas de base de
 *    datos, pero un artefacto nunca contiene líneas sin cifrar, y aceptarlas
 *    aquí abriría una degradación de formato a voluntad de quien toca el fichero;
 *  - una cabecera desconocida es un error, no un artefacto legado.
 */
final class PrivateArtifact
{
    public const HEADER = 'uvh-private-artifact-v2';

    /** Bloques de texto plano de 4 MiB: la memoria viva no depende del tamaño del documento. */
    public const CHUNK_BYTES = 4 * 1024 * 1024;

    /**
     * Escribe el artefacto cifrando por bloques desde un stream de texto plano.
     * Devuelve los bytes de texto plano escritos. Si la escritura se interrumpe,
     * el fichero queda a medias en su ruta definitiva —la fila en `processing`
     * es el ancla y la recuperación de housekeeping la borra—, igual que en el
     * formato legado.
     *
     * @param  resource  $plainStream
     */
    public static function write(string $path, $plainStream): int
    {
        $disk = Storage::disk('local');
        // Un volumen privado recién creado no trae el directorio de artefactos;
        // crearlo aquí es idempotente y no cambia nada cuando ya existe.
        $disk->makeDirectory(dirname($path));
        $out = @fopen($disk->path($path), 'wb');
        if (! is_resource($out)) {
            throw new \RuntimeException('Private artifact storage rejected write');
        }
        try {
            // Escrituras verificadas: un artifact truncado nunca se puede
            // declarar completo. Si algo no llega íntegro, hay excepción y la
            // fila en `processing` queda como ancla para el housekeeping.
            Streams::writeAll($out, self::HEADER."\n");
            $written = 0;
            while (! feof($plainStream)) {
                $chunk = self::readPlainChunk($plainStream, self::CHUNK_BYTES);
                if ($chunk === '') {
                    break;
                }
                $written += strlen($chunk);
                Streams::writeAll($out, UvhCrypto::encryptAtRest($chunk)."\n");
            }
            Streams::flush($out);
        } finally {
            fclose($out);
        }

        return $written;
    }

    /**
     * Valida la FORMA del artefacto —cabecera de bloques o blob legado— sin
     * descifrar nada, y rebobina el stream. Sirve para responder un 503 antes
     * de los encabezados cuando el fichero no es un artefacto de este sistema;
     * la autenticación de cada bloque ocurre al servirlo.
     *
     * @param  resource  $cipherStream
     */
    public static function validate($cipherStream): void
    {
        $first = fgets($cipherStream);
        rewind($cipherStream);
        if ($first === false) {
            throw new \RuntimeException('Private artifact is empty');
        }
        $first = rtrim($first, "\n");
        if ($first === self::HEADER || str_starts_with($first, self::HEADER)) {
            if ($first !== self::HEADER) {
                throw new \RuntimeException('Private artifact header is unknown');
            }

            return;
        }
        if (! UvhCrypto::isAtRestCiphertext($first)) {
            throw new \RuntimeException('Private artifact is not ciphertext');
        }
    }

    /**
     * Descifra el artefacto como un flujo de fragmentos de texto plano. El
     * primer fragmento (toda la cabecera) se resuelve al empezar: un artefacto
     * legado se descifra entero aquí dentro, pero los suyos son pequeños por
     * construcción.
     *
     * @param  resource  $cipherStream
     * @return \Generator<int, string>
     */
    public static function readChunks($cipherStream): \Generator
    {
        $first = fgets($cipherStream);
        if ($first === false) {
            throw new \RuntimeException('Private artifact is empty');
        }
        $first = rtrim($first, "\n");

        if ($first === self::HEADER) {
            while (($line = fgets($cipherStream)) !== false) {
                $line = rtrim($line, "\n");
                if (trim($line) === '') {
                    continue;
                }
                if (! UvhCrypto::isAtRestCiphertext($line)) {
                    throw new \RuntimeException('Private artifact contains an unencrypted chunk line');
                }
                yield UvhCrypto::decryptAtRest($line);
            }

            return;
        }

        if (str_starts_with($first, self::HEADER)) {
            throw new \RuntimeException('Private artifact header is unknown');
        }

        // Formato legado: sin saltos de línea, la primera línea es el blob
        // entero. Estricto aquí también: un artefacto siempre está cifrado.
        if (! UvhCrypto::isAtRestCiphertext($first)) {
            throw new \RuntimeException('Private artifact is not ciphertext');
        }
        yield UvhCrypto::decryptAtRest($first);
    }

    /** ¿Está todo el artefacto cifrado con la clave actual del keyring? */
    public static function encryptedWithCurrentKey(string $contents): bool
    {
        foreach (self::chunkLines($contents) as $line) {
            if (! UvhCrypto::encryptedWithCurrentKey($line)) {
                return false;
            }
        }

        return true;
    }

    /** Recifra todo el artefacto con la clave actual, conservando su formato. */
    public static function reencrypt(string $contents): string
    {
        $lines = explode("\n", $contents);
        if ($lines[0] !== self::HEADER) {
            // Blob legado: un solo cuerpo, su propio recifrado entero.
            if (! UvhCrypto::isAtRestCiphertext(rtrim($contents, "\n"))) {
                throw new \RuntimeException('Private artifact is not ciphertext');
            }

            return UvhCrypto::encryptAtRest(UvhCrypto::decryptAtRest(rtrim($contents, "\n")));
        }

        $out = [self::HEADER];
        foreach (array_slice($lines, 1) as $line) {
            if (trim($line) === '') {
                continue;
            }
            if (! UvhCrypto::isAtRestCiphertext($line)) {
                throw new \RuntimeException('Private artifact contains an unencrypted chunk line');
            }
            $out[] = UvhCrypto::encryptAtRest(UvhCrypto::decryptAtRest($line));
        }

        return implode("\n", $out)."\n";
    }

    /**
     * Recifra un artefacto de un stream a otro con la clave actual, conservando
     * su formato y con la memoria viva de UN BLOQUE: la generación sostiene el
     * artefacto sin cargarlo en RAM y la rotación de `APP_SECRET` también.
     * Devuelve si algo cambió —con `false`, el destino es idéntico al origen y
     * el llamante lo descarta—.
     *
     * @param  resource  $in
     * @param  resource  $out
     */
    public static function reencryptStream($in, $out): bool
    {
        $first = fgets($in);
        if ($first === false) {
            throw new \RuntimeException('Private artifact is empty');
        }
        $first = rtrim($first, "\n");
        $changed = false;

        if ($first === self::HEADER) {
            Streams::writeAll($out, self::HEADER."\n");
            while (($line = fgets($in)) !== false) {
                $line = rtrim($line, "\n");
                if (trim($line) === '') {
                    continue;
                }
                if (! UvhCrypto::isAtRestCiphertext($line)) {
                    throw new \RuntimeException('Private artifact contains an unencrypted chunk line');
                }
                if (! UvhCrypto::encryptedWithCurrentKey($line)) {
                    $line = UvhCrypto::encryptAtRest(UvhCrypto::decryptAtRest($line));
                    $changed = true;
                }
                Streams::writeAll($out, $line."\n");
            }

            return $changed;
        }

        if (str_starts_with($first, self::HEADER)) {
            throw new \RuntimeException('Private artifact header is unknown');
        }
        // Formato legado: un solo cuerpo, su recifrado entero —los artefactos
        // legados son pequeños por construcción—.
        if (! UvhCrypto::isAtRestCiphertext($first)) {
            throw new \RuntimeException('Private artifact is not ciphertext');
        }
        if (! UvhCrypto::encryptedWithCurrentKey($first)) {
            $first = UvhCrypto::encryptAtRest(UvhCrypto::decryptAtRest($first));
            $changed = true;
        }
        Streams::writeAll($out, $first."\n");

        return $changed;
    }

    /**
     * Las líneas cifradas del artefacto, con la misma tolerancia de formato que
     * la lectura: sin cabecera de bloques, el contenido entero es el blob legado.
     *
     * @return list<string>
     */
    private static function chunkLines(string $contents): array
    {
        $lines = explode("\n", rtrim($contents, "\n"));
        if ($lines[0] === self::HEADER) {
            return array_values(array_filter(array_slice($lines, 1), static fn (string $line): bool => trim($line) !== ''));
        }

        return [$contents];
    }

    /**
     * Exactamente `$bytes` bytes de texto plano, o menos en el último bloque.
     *
     * @param  resource  $stream
     */
    private static function readPlainChunk($stream, int $bytes): string
    {
        $buffer = '';
        while (strlen($buffer) < $bytes && ! feof($stream)) {
            $read = fread($stream, $bytes - strlen($buffer));
            if ($read === false) {
                break;
            }
            $buffer .= $read;
        }

        return $buffer;
    }
}
