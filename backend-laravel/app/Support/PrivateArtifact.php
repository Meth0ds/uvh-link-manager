<?php

namespace App\Support;

use Illuminate\Support\Facades\Storage;

/**
 * El artefacto privado: contenedor cifrado en reposo de un documento que puede
 * ser mucho más grande que la memoria del proceso.
 *
 * Formato por bloques (`uvh-private-artifact-v3`), una línea por bloque y un
 * PIE que los sella:
 *
 * ```
 * uvh-private-artifact-v3
 * enc:v1:<base64url(iv|tag|cipher del bloque 1)>
 * enc:v1:<base64url(iv|tag|cipher del bloque 2)>
 * end:enc:v1:<base64url(iv|tag|cipher del pie)>
 * ```
 *
 * El pie es un manifiesto cifrado y autenticado con la clave en reposo —
 * `{chunks, plaintextBytes, sha256}` de TODO el texto plano—. Un documento
 * truncado exactamente en un límite de bloque deja de ser indistinguible de
 * uno íntegro: sin pie no hay fin de artefacto, y con pie ajeno no cuadran
 * bloques, bytes ni digest. La lectura sostiene como máximo dos bloques vivos
 * —el verificado y el siguiente—: el ÚLTIMO bloque se entrega sólo después de
 * comprobar el pie, de modo que un artefacto que no cuadra con su manifiesto
 * nunca se entrega completo. Escritura y recifrado siguen siendo de un bloque.
 *
 * Cada bloque es un `UvhCrypto::encryptAtRest` completo —su propio IV y su
 * propia tag—, así que la autenticación es por bloque y la corrupción se
 * detecta en el bloque exacto que la sufre.
 *
 * El formato legado —un solo blob `enc:v1:...` sin saltos de línea— y el
 * formato `uvh-private-artifact-v2` —bloques sin pie— siguen abriéndose y
 * recifrando: los artefactos viven 48 horas y la ventana de rotación puede
 * cruzarse con los emitidos por formatos anteriores. Carecen del sello global;
 * sólo v3 lo tiene y la rotación conserva el formato de cada artefacto.
 *
 * Reglas que el lector impone y no negocia:
 *
 *  - una línea de bloque sin prefijo de ciphertext NO se acepta como texto
 *    plano: `decryptAtRest` tolera el texto heredado para columnas de base de
 *    datos, pero un artefacto nunca contiene líneas sin cifrar, y aceptarlas
 *    aquí abriría una degradación de formato a voluntad de quien toca el fichero;
 *  - una cabecera desconocida es un error, no un artefacto legado;
 *  - en v3 hay exactamente un pie, va al final y nada le sigue: un artefacto
 *    sin pie o con bloques después del pie es un artefacto incompleto.
 */
final class PrivateArtifact
{
    /** El formato que este sistema escribe. */
    public const HEADER = 'uvh-private-artifact-v3';

    /** Formato anterior por bloques, sin pie: legible durante la ventana de convivencia. */
    public const HEADER_V2 = 'uvh-private-artifact-v2';

    /** Común a todas las cabeceras de formato por bloques. */
    private const HEADER_PREFIX = 'uvh-private-artifact';

    /** Prefijo de la línea de pie; lo que sigue es un ciphertext en reposo completo. */
    public const FOOTER_PREFIX = 'end:';

    /** Bloques de texto plano de 4 MiB: la memoria viva no depende del tamaño del documento. */
    public const CHUNK_BYTES = 4 * 1024 * 1024;

    /**
     * Escribe el artefacto cifrando por bloques desde un stream de texto plano,
     * y cierra con el pie que sella bloques, bytes y digest del documento.
     * Devuelve los bytes de texto plano escritos. Si la escritura se interrumpe,
     * el fichero queda a medias en su ruta definitiva —sin pie— y TODO lector lo
     * rechaza como incompleto; la fila en `processing` es el ancla y la
     * recuperación de housekeeping la borra.
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
            $hash = hash_init('sha256');
            $written = 0;
            $chunks = 0;
            while (! feof($plainStream)) {
                $chunk = Streams::readChunk($plainStream, self::CHUNK_BYTES);
                if ($chunk === '') {
                    break;
                }
                $written += strlen($chunk);
                hash_update($hash, $chunk);
                $chunks++;
                Streams::writeAll($out, UvhCrypto::encryptAtRest($chunk)."\n");
            }
            Streams::writeAll($out, self::footerLine($chunks, $written, hash_final($hash))."\n");
            Streams::flush($out);
        } finally {
            fclose($out);
        }

        return $written;
    }

    /**
     * Valida la FORMA del artefacto —cabecera, estructura de líneas y pie— sin
     * descifrar bloques, y rebobina el stream. En v3 exige el pie y que su
     * recuento de bloques cuadre con las líneas presentes, así una extracción
     * en un límite de bloque se responde ANTES de los encabezados como 503 y
     * sin consumir nada. Devuelve el manifiesto del pie (null en formatos sin
     * pie). La autenticación de cada bloque y el digest global ocurren al
     * servirlo.
     *
     * @param  resource  $cipherStream
     * @return array{chunks: int, plaintextBytes: int, sha256: string}|null
     */
    public static function validate($cipherStream): ?array
    {
        $first = Streams::readLine($cipherStream);
        if ($first === false) {
            throw new \RuntimeException('Private artifact is empty');
        }
        $first = rtrim($first, "\n");
        if ($first === self::HEADER) {
            $manifest = self::scanFooter($cipherStream);
            if (! rewind($cipherStream)) {
                throw new \RuntimeException('Private artifact rewind failed');
            }

            return $manifest;
        }
        if (! rewind($cipherStream)) {
            throw new \RuntimeException('Private artifact rewind failed');
        }
        if ($first === self::HEADER_V2) {
            return null;
        }
        if (str_starts_with($first, self::HEADER_PREFIX)) {
            throw new \RuntimeException('Private artifact header is unknown');
        }
        if (! UvhCrypto::isAtRestCiphertext($first)) {
            throw new \RuntimeException('Private artifact is not ciphertext');
        }

        return null;
    }

    /**
     * Descifra el artefacto como un flujo de fragmentos de texto plano. El
     * primer fragmento (toda la cabecera) se resuelve al empezar: un artefacto
     * legado se descifra entero aquí dentro, pero los suyos son pequeños por
     * construcción.
     *
     * En v3 el ÚLTIMO bloque se entrega sólo después de comprobar el pie:
     * bloques, bytes y digest tienen que cuadrar con el manifiesto sellado o
     * hay excepción —un artefacto truncado o reordenado nunca se sirve como
     * completo—. En v2 y legado, sin pie, la comprobación es sólo por bloque.
     *
     * @param  resource  $cipherStream
     * @return \Generator<int, string>
     */
    public static function readChunks($cipherStream): \Generator
    {
        $first = Streams::readLine($cipherStream);
        if ($first === false) {
            throw new \RuntimeException('Private artifact is empty');
        }
        $first = rtrim($first, "\n");

        if ($first === self::HEADER) {
            $hash = hash_init('sha256');
            $bytes = 0;
            $chunks = 0;
            $pending = null;
            $manifest = null;
            while (($line = Streams::readLine($cipherStream)) !== false) {
                $line = rtrim($line, "\n");
                if (trim($line) === '') {
                    continue;
                }
                if (str_starts_with($line, self::FOOTER_PREFIX)) {
                    if ($manifest !== null) {
                        throw new \RuntimeException('Private artifact has more than one footer');
                    }
                    // El pie se comprueba aquí, con el digest de todos los
                    // bloques ya calculado; el último bloque sigue retenido.
                    $manifest = self::manifestOf($line);
                    self::assertManifest($manifest, $chunks, $bytes, hash_final($hash));

                    continue;
                }
                if ($manifest !== null) {
                    throw new \RuntimeException('Private artifact has content after its footer');
                }
                if (! UvhCrypto::isAtRestCiphertext($line)) {
                    throw new \RuntimeException('Private artifact contains an unencrypted chunk line');
                }
                $plain = UvhCrypto::decryptAtRest($line);
                hash_update($hash, $plain);
                $bytes += strlen($plain);
                $chunks++;
                if ($pending !== null) {
                    yield $pending;
                }
                $pending = $plain;
            }
            if ($manifest === null) {
                throw new \RuntimeException('Private artifact is incomplete: footer is missing');
            }
            if ($pending !== null) {
                yield $pending;
            }

            return;
        }

        if ($first === self::HEADER_V2) {
            while (($line = Streams::readLine($cipherStream)) !== false) {
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

        if (str_starts_with($first, self::HEADER_PREFIX)) {
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
        if ($lines[0] === self::HEADER) {
            $out = [self::HEADER];
            $hash = hash_init('sha256');
            $bytes = 0;
            $chunks = 0;
            $footer = null;
            foreach (array_slice($lines, 1) as $line) {
                if (trim($line) === '') {
                    continue;
                }
                if (str_starts_with($line, self::FOOTER_PREFIX)) {
                    if ($footer !== null) {
                        throw new \RuntimeException('Private artifact has more than one footer');
                    }
                    $footer = self::manifestOf($line);

                    continue;
                }
                if ($footer !== null) {
                    throw new \RuntimeException('Private artifact has content after its footer');
                }
                if (! UvhCrypto::isAtRestCiphertext($line)) {
                    throw new \RuntimeException('Private artifact contains an unencrypted chunk line');
                }
                $plain = UvhCrypto::decryptAtRest($line);
                hash_update($hash, $plain);
                $bytes += strlen($plain);
                $chunks++;
                $out[] = UvhCrypto::encryptAtRest($plain);
            }
            if ($footer === null) {
                throw new \RuntimeException('Private artifact is incomplete: footer is missing');
            }
            $digest = hash_final($hash);
            self::assertManifest($footer, $chunks, $bytes, $digest);
            $out[] = self::footerLine($chunks, $bytes, $digest);

            return implode("\n", $out)."\n";
        }
        if ($lines[0] === self::HEADER_V2) {
            $out = [self::HEADER_V2];
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

        // Blob legado: un solo cuerpo, su propio recifrado entero.
        if (! UvhCrypto::isAtRestCiphertext(rtrim($contents, "\n"))) {
            throw new \RuntimeException('Private artifact is not ciphertext');
        }

        return UvhCrypto::encryptAtRest(UvhCrypto::decryptAtRest(rtrim($contents, "\n")));
    }

    /**
     * Recifra un artefacto de un stream a otro con la clave actual, conservando
     * su formato y con la memoria viva de UN BLOQUE: la generación sostiene el
     * artefacto sin cargarlo en RAM y la rotación de `APP_SECRET` también.
     * Devuelve si algo cambió —con `false`, el destino es idéntico al origen y
     * el llamante lo descarta—.
     *
     * En v3 el pie se verifica contra los bloques leídos ANTES de escribirse:
     * un artefacto truncado o alterado lanza y el llamante nunca publica el
     * temporal sobre el original.
     *
     * @param  resource  $in
     * @param  resource  $out
     */
    public static function reencryptStream($in, $out): bool
    {
        $first = Streams::readLine($in);
        if ($first === false) {
            throw new \RuntimeException('Private artifact is empty');
        }
        $first = rtrim($first, "\n");
        $changed = false;

        if ($first === self::HEADER) {
            Streams::writeAll($out, self::HEADER."\n");
            $hash = hash_init('sha256');
            $bytes = 0;
            $chunks = 0;
            $manifest = null;
            $footerLine = null;
            while (($line = Streams::readLine($in)) !== false) {
                $line = rtrim($line, "\n");
                if (trim($line) === '') {
                    continue;
                }
                if (str_starts_with($line, self::FOOTER_PREFIX)) {
                    if ($manifest !== null) {
                        throw new \RuntimeException('Private artifact has more than one footer');
                    }
                    $footerLine = $line;
                    $manifest = self::manifestOf($line);

                    continue;
                }
                if ($manifest !== null) {
                    throw new \RuntimeException('Private artifact has content after its footer');
                }
                if (! UvhCrypto::isAtRestCiphertext($line)) {
                    throw new \RuntimeException('Private artifact contains an unencrypted chunk line');
                }
                $plain = UvhCrypto::decryptAtRest($line);
                hash_update($hash, $plain);
                $bytes += strlen($plain);
                $chunks++;
                if (! UvhCrypto::encryptedWithCurrentKey($line)) {
                    $line = UvhCrypto::encryptAtRest($plain);
                    $changed = true;
                }
                Streams::writeAll($out, $line."\n");
            }
            if ($manifest === null) {
                throw new \RuntimeException('Private artifact is incomplete: footer is missing');
            }
            self::assertManifest($manifest, $chunks, $bytes, hash_final($hash));
            // El manifiesto se conserva tal cual; sólo se recifra si su bloque
            // no está con la clave actual.
            if (! UvhCrypto::encryptedWithCurrentKey(substr($footerLine, strlen(self::FOOTER_PREFIX)))) {
                $footerLine = self::footerLineFromJson(self::footerJson($footerLine));
                $changed = true;
            }
            Streams::writeAll($out, $footerLine."\n");

            return $changed;
        }

        if ($first === self::HEADER_V2) {
            Streams::writeAll($out, self::HEADER_V2."\n");
            while (($line = Streams::readLine($in)) !== false) {
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

        if (str_starts_with($first, self::HEADER_PREFIX)) {
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
     * la lectura: sin cabecera de bloques, el contenido entero es el blob
     * legado. El pie se normaliza a su ciphertext para las comprobaciones de
     * clave.
     *
     * @return list<string>
     */
    private static function chunkLines(string $contents): array
    {
        $lines = explode("\n", rtrim($contents, "\n"));
        if ($lines[0] === self::HEADER || $lines[0] === self::HEADER_V2) {
            $out = [];
            foreach (array_slice($lines, 1) as $line) {
                if (trim($line) === '') {
                    continue;
                }
                $out[] = str_starts_with($line, self::FOOTER_PREFIX)
                    ? substr($line, strlen(self::FOOTER_PREFIX))
                    : $line;
            }

            return $out;
        }

        return [$contents];
    }

    /**
     * Recorre las líneas de un artefacto v3 sin descifrar bloques: exige un
     * único pie al final y que su recuento de bloques cuadre. Devuelve el
     * manifiesto.
     *
     * @param  resource  $cipherStream
     * @return array{chunks: int, plaintextBytes: int, sha256: string}
     */
    private static function scanFooter($cipherStream): array
    {
        $chunks = 0;
        $manifest = null;
        while (($line = Streams::readLine($cipherStream)) !== false) {
            $line = rtrim($line, "\n");
            if (trim($line) === '') {
                continue;
            }
            if (str_starts_with($line, self::FOOTER_PREFIX)) {
                if ($manifest !== null) {
                    throw new \RuntimeException('Private artifact has more than one footer');
                }
                $manifest = self::manifestOf($line);

                continue;
            }
            if ($manifest !== null) {
                throw new \RuntimeException('Private artifact has content after its footer');
            }
            if (! UvhCrypto::isAtRestCiphertext($line)) {
                throw new \RuntimeException('Private artifact contains an unencrypted chunk line');
            }
            $chunks++;
        }
        if ($manifest === null) {
            throw new \RuntimeException('Private artifact is incomplete: footer is missing');
        }
        if ($manifest['chunks'] !== $chunks) {
            throw new \RuntimeException('Private artifact chunk count does not match its footer');
        }

        return $manifest;
    }

    /** @return array{chunks: int, plaintextBytes: int, sha256: string} */
    private static function manifestOf(string $footerLine): array
    {
        return self::decodeManifest(self::footerJson($footerLine));
    }

    private static function footerJson(string $footerLine): string
    {
        $blob = substr($footerLine, strlen(self::FOOTER_PREFIX));
        if (! UvhCrypto::isAtRestCiphertext($blob)) {
            throw new \RuntimeException('Private artifact footer is not ciphertext');
        }

        return UvhCrypto::decryptAtRest($blob);
    }

    /** @return array{chunks: int, plaintextBytes: int, sha256: string} */
    private static function decodeManifest(string $json): array
    {
        $manifest = json_decode($json, true);
        if (! is_array($manifest)
            || ! isset($manifest['chunks'], $manifest['plaintextBytes'], $manifest['sha256'])
            || ! is_int($manifest['chunks']) || $manifest['chunks'] < 0
            || ! is_int($manifest['plaintextBytes']) || $manifest['plaintextBytes'] < 0
            || ! is_string($manifest['sha256'])
            || preg_match('/^[0-9a-f]{64}$/D', $manifest['sha256']) !== 1
        ) {
            throw new \RuntimeException('Private artifact footer is malformed');
        }

        return [
            'chunks' => $manifest['chunks'],
            'plaintextBytes' => $manifest['plaintextBytes'],
            'sha256' => $manifest['sha256'],
        ];
    }

    /** @param array{chunks: int, plaintextBytes: int, sha256: string} $manifest */
    private static function assertManifest(array $manifest, int $chunks, int $bytes, string $digest): void
    {
        if ($manifest['chunks'] !== $chunks
            || $manifest['plaintextBytes'] !== $bytes
            || ! hash_equals($manifest['sha256'], $digest)
        ) {
            throw new \RuntimeException('Private artifact does not match its footer manifest');
        }
    }

    private static function footerLine(int $chunks, int $bytes, string $digest): string
    {
        return self::footerLineFromJson(json_encode([
            'chunks' => $chunks,
            'plaintextBytes' => $bytes,
            'sha256' => $digest,
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
    }

    private static function footerLineFromJson(string $json): string
    {
        return self::FOOTER_PREFIX.UvhCrypto::encryptAtRest($json);
    }
}
