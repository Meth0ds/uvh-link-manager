<?php

namespace Tests\Feature;

use App\Support\PrivateArtifact;
use App\Support\UvhCrypto;
use Illuminate\Support\Facades\Storage;
use Tests\Fixtures\FailedReadStream;
use Tests\TestCase;

/**
 * El contenedor cifrado por bloques: memoria acotada por construcción —un
 * bloque vivo a la vez—, compatibilidad con el blob legado y ninguna línea sin
 * cifrar admitida jamás.
 */
final class PrivateArtifactTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    public function test_a_chunked_artifact_round_trips_across_block_boundaries(): void
    {
        // Más de dos bloques de 4 MiB: el documento cruza fronteras de bloque
        // dos veces y el último bloque va corto. Las comprobaciones van también
        // por streaming —una línea y un bloque vivos a la vez—, que es la
        // propiedad de memoria que el contenedor promete y que este tamaño de
        // artefacto permite vigilar de verdad.
        $plain = str_repeat('0123456789abcdef', (9 * 1024 * 1024) / 16);
        $path = 'account-exports/'.str_repeat('A', 32).'.uvh';

        $stream = $this->streamOf($plain);
        $written = PrivateArtifact::write($path, $stream);
        fclose($stream);
        $this->assertSame(strlen($plain), $written);

        $artifact = Storage::disk('local')->path($path);
        $scan = fopen($artifact, 'rb');
        $this->assertIsResource($scan);
        $lines = 0;
        $sawFooter = false;
        while (($line = fgets($scan)) !== false) {
            $line = rtrim($line, "\n");
            if ($lines === 0) {
                $this->assertSame(PrivateArtifact::HEADER, $line);
            } elseif (str_starts_with($line, PrivateArtifact::FOOTER_PREFIX)) {
                $sawFooter = true;
                $this->assertTrue(UvhCrypto::isAtRestCiphertext(substr($line, strlen(PrivateArtifact::FOOTER_PREFIX))));
            } else {
                $this->assertFalse($sawFooter, 'no chunk line may follow the footer');
                $this->assertTrue(UvhCrypto::isAtRestCiphertext($line));
                $this->assertTrue(UvhCrypto::encryptedWithCurrentKey($line));
            }
            $lines += 1;
        }
        fclose($scan);
        $this->assertTrue($sawFooter, 'a v3 artifact must close with its manifest footer');
        $this->assertSame(2 + (int) ceil(strlen($plain) / PrivateArtifact::CHUNK_BYTES), $lines);

        $cipher = fopen($artifact, 'rb');
        $this->assertIsResource($cipher);
        $manifest = PrivateArtifact::validate($cipher);
        $this->assertSame([
            'chunks' => (int) ceil(strlen($plain) / PrivateArtifact::CHUNK_BYTES),
            'plaintextBytes' => strlen($plain),
            'sha256' => hash('sha256', $plain),
        ], $manifest, 'the footer seals chunks, bytes and digest of the document');
        $offset = 0;
        foreach (PrivateArtifact::readChunks($cipher) as $chunk) {
            $this->assertSame(substr($plain, $offset, strlen($chunk)), $chunk);
            $offset += strlen($chunk);
        }
        fclose($cipher);
        $this->assertSame(strlen($plain), $offset);
    }

    public function test_the_legacy_single_blob_still_opens_and_reencrypts(): void
    {
        $blob = UvhCrypto::encryptAtRest('{"format":"legacy"}');

        $cipher = $this->streamOf($blob);
        PrivateArtifact::validate($cipher);
        $chunks = iterator_to_array(PrivateArtifact::readChunks($cipher), false);
        fclose($cipher);
        $this->assertSame(['{"format":"legacy"}'], $chunks);

        $this->assertTrue(PrivateArtifact::encryptedWithCurrentKey($blob));
        $this->assertNotSame($blob, PrivateArtifact::reencrypt($blob), 're-encryption must mint fresh ciphertext');
        $replaced = $this->streamOf(PrivateArtifact::reencrypt($blob));
        $this->assertSame('{"format":"legacy"}', iterator_to_array(PrivateArtifact::readChunks($replaced), false)[0]);
        fclose($replaced);
    }

    public function test_reencrypt_stream_preserves_a_chunked_artifact_with_the_current_key(): void
    {
        // La rotación de APP_SECRET recifra por streaming: más de dos bloques
        // cruzan fronteras y ni el origen ni el destino viven enteros en RAM.
        config(['uvh.secret' => 'vieja-clave-de-rotacion-0123456789abcdef', 'uvh.secret_previous' => []]);
        $plain = str_repeat('0123456789abcdef', (9 * 1024 * 1024) / 16);
        $path = 'account-exports/'.str_repeat('R', 32).'.uvh';
        $stream = $this->streamOf($plain);
        PrivateArtifact::write($path, $stream);
        fclose($stream);

        config(['uvh.secret' => 'clave-actual-de-rotacion-0123456789ab', 'uvh.secret_previous' => ['vieja-clave-de-rotacion-0123456789abcdef']]);
        $in = fopen(Storage::disk('local')->path($path), 'rb');
        $this->assertIsResource($in);
        $out = fopen('php://temp/maxmemory:2097152', 'r+b');
        $this->assertIsResource($out);
        $changed = PrivateArtifact::reencryptStream($in, $out);
        fclose($in);
        $this->assertTrue($changed, 'old-key blocks must be re-encrypted');

        rewind($out);
        $rebuilt = '';
        foreach (PrivateArtifact::readChunks($out) as $chunk) {
            $rebuilt .= $chunk;
        }
        fclose($out);
        $this->assertSame($plain, $rebuilt, 'the streamed re-encryption must preserve every byte');
    }

    public function test_reencrypt_stream_reports_unchanged_for_an_artifact_with_the_current_key(): void
    {
        $plain = '{"format":"current-key"}';
        $path = 'account-exports/'.str_repeat('S', 32).'.uvh';
        $stream = $this->streamOf($plain);
        PrivateArtifact::write($path, $stream);
        fclose($stream);

        $in = fopen(Storage::disk('local')->path($path), 'rb');
        $this->assertIsResource($in);
        $out = fopen('php://temp/maxmemory:2097152', 'r+b');
        $this->assertIsResource($out);
        $changed = PrivateArtifact::reencryptStream($in, $out);
        fclose($in);
        fclose($out);
        $this->assertFalse($changed, 'an artifact already with the current key must not be rewritten');
    }

    public function test_reencrypt_stream_keeps_the_legacy_blob_format(): void
    {
        config(['uvh.secret' => 'vieja-clave-de-rotacion-0123456789abcdef', 'uvh.secret_previous' => []]);
        $blob = UvhCrypto::encryptAtRest('{"format":"legacy"}');

        config(['uvh.secret' => 'clave-actual-de-rotacion-0123456789ab', 'uvh.secret_previous' => ['vieja-clave-de-rotacion-0123456789abcdef']]);
        $in = $this->streamOf($blob);
        $out = fopen('php://temp/maxmemory:2097152', 'r+b');
        $this->assertIsResource($out);
        $changed = PrivateArtifact::reencryptStream($in, $out);
        fclose($in);
        $this->assertTrue($changed);

        rewind($out);
        $this->assertSame('{"format":"legacy"}', iterator_to_array(PrivateArtifact::readChunks($out), false)[0]);
        fclose($out);
    }

    public function test_an_artifact_truncated_at_a_block_boundary_is_refused_in_full(): void
    {
        // El pie sella bloques, bytes y digest: un documento cortado justo en
        // un límite de bloque deja de ser indistinguible de uno íntegro. Sin
        // pie no hay fin de artefacto —ni al validar, ni al servir, ni al
        // recifrar—, así la rotación jamás publica un prefijo truncado sobre el
        // original ni una descarga se entrega como completa.
        $plain = str_repeat('x', PrivateArtifact::CHUNK_BYTES).'tail';
        $path = 'account-exports/'.str_repeat('T', 32).'.uvh';
        $stream = $this->streamOf($plain);
        PrivateArtifact::write($path, $stream);
        fclose($stream);

        $lines = explode("\n", rtrim(file_get_contents(Storage::disk('local')->path($path)), "\n"));
        array_pop($lines); // quita el pie: truncación en el límite del último bloque
        $truncated = implode("\n", $lines)."\n";

        $cipher = $this->streamOf($truncated);
        try {
            PrivateArtifact::validate($cipher);
            $this->fail('an artifact without its footer must be refused before serving');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('footer', $e->getMessage());
        } finally {
            fclose($cipher);
        }

        $cipher = $this->streamOf($truncated);
        try {
            iterator_to_array(PrivateArtifact::readChunks($cipher), false);
            $this->fail('a truncated artifact must not be served as complete');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('footer', $e->getMessage());
        } finally {
            fclose($cipher);
        }

        $in = $this->streamOf($truncated);
        $out = fopen('php://temp', 'r+b');
        try {
            PrivateArtifact::reencryptStream($in, $out);
            $this->fail('rotation must never re-encrypt a truncated artifact');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('footer', $e->getMessage());
        } finally {
            fclose($in);
            fclose($out);
        }
    }

    public function test_a_dropped_chunk_cannot_hide_behind_a_kept_footer(): void
    {
        // Mantener el pie y soltar un bloque entero: el recuento del manifiesto
        // no cuadra y la validación rechaza antes de servir nada.
        $plain = str_repeat('y', PrivateArtifact::CHUNK_BYTES + 16);
        $path = 'account-exports/'.str_repeat('D', 32).'.uvh';
        $stream = $this->streamOf($plain);
        PrivateArtifact::write($path, $stream);
        fclose($stream);

        $lines = explode("\n", rtrim(file_get_contents(Storage::disk('local')->path($path)), "\n"));
        unset($lines[1]); // primer bloque: desaparece, el pie se queda
        $tampered = implode("\n", array_values($lines))."\n";

        $cipher = $this->streamOf($tampered);
        try {
            PrivateArtifact::validate($cipher);
            $this->fail('a chunk count that contradicts the footer must be refused');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('chunk count', $e->getMessage());
        } finally {
            fclose($cipher);
        }
    }

    public function test_a_foreign_footer_never_seals_another_document(): void
    {
        // Un pie ajeno —mismo recuento de bloques— no puede sellar otro
        // documento: ni el digest cuadra al servir, ni el recifrado lo publica.
        $first = 'documento uno';
        $second = 'documento dos';
        $pathA = 'account-exports/'.str_repeat('F', 32).'.uvh';
        $pathB = 'account-exports/'.str_repeat('G', 32).'.uvh';
        foreach ([[$first, $pathA], [$second, $pathB]] as [$plain, $path]) {
            $stream = $this->streamOf($plain);
            PrivateArtifact::write($path, $stream);
            fclose($stream);
        }

        $split = fn (string $file): array => explode("\n", rtrim(file_get_contents(Storage::disk('local')->path($file)), "\n"));
        $linesA = $split($pathA);
        $linesB = $split($pathB);
        $footerB = array_pop($linesB);
        $forged = implode("\n", [$linesA[0], $linesA[1], $footerB])."\n";

        $cipher = $this->streamOf($forged);
        // La forma cuadra: mismo recuento de bloques que el pie ajeno.
        PrivateArtifact::validate($cipher);
        try {
            iterator_to_array(PrivateArtifact::readChunks($cipher), false);
            $this->fail('a foreign footer must not seal this document');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('footer manifest', $e->getMessage());
        } finally {
            fclose($cipher);
        }
        // Mismo recuento de bytes que el pie ajeno: sólo el digest los separa.
        $this->assertSame(strlen($first), strlen($second));
    }

    public function test_an_undecrypted_chunk_line_is_refused_never_read_as_plaintext(): void
    {
        // `decryptAtRest` tolera texto heredado para columnas de base de datos;
        // un artefacto, nunca: aceptar una línea sin cifrar sería una degradación
        // de formato a voluntad de quien toca el fichero.
        $tampered = PrivateArtifact::HEADER."\n".'{"forged":true}'."\n";

        $cipher = $this->streamOf($tampered);
        try {
            iterator_to_array(PrivateArtifact::readChunks($cipher), false);
            $this->fail('an unencrypted chunk line must be refused');
        } catch (\RuntimeException) {
            $this->addToAssertionCount(1);
        } finally {
            fclose($cipher);
        }

        $this->expectException(\RuntimeException::class);
        PrivateArtifact::validate($this->streamOf('{"not":"an artifact"}'));
    }

    public function test_an_unknown_header_is_an_error_not_a_legacy_artifact(): void
    {
        $this->expectException(\RuntimeException::class);
        $cipher = $this->streamOf("uvh-private-artifact-v9\n".UvhCrypto::encryptAtRest('x')."\n");
        try {
            PrivateArtifact::validate($cipher);
        } finally {
            fclose($cipher);
        }
    }

    public function test_failed_source_reads_abort_generation_download_and_rotation(): void
    {
        stream_wrapper_register('uvh-read-failure', FailedReadStream::class);
        FailedReadStream::$stall = false;
        try {
            foreach (['write', 'read', 'rotate'] as $operation) {
                FailedReadStream::$prefix = $operation === 'write'
                    ? 'partial document'
                    : PrivateArtifact::HEADER."\n".UvhCrypto::encryptAtRest('first block')."\n";
                $source = fopen('uvh-read-failure://source', 'rb');
                $out = fopen('php://temp', 'r+b');
                try {
                    if ($operation === 'write') {
                        PrivateArtifact::write('account-exports/failure.uvh', $source);
                    } elseif ($operation === 'read') {
                        iterator_to_array(PrivateArtifact::readChunks($source), false);
                    } else {
                        PrivateArtifact::reencryptStream($source, $out);
                    }
                    $this->fail($operation.' must reject an I/O failure after a readable prefix');
                } catch (\RuntimeException $e) {
                    $this->assertStringContainsString('Stream', $e->getMessage());
                } finally {
                    fclose($source);
                    fclose($out);
                }
            }
        } finally {
            stream_wrapper_unregister('uvh-read-failure');
        }
    }

    /** @return resource */
    private function streamOf(string $contents)
    {
        $stream = fopen('php://temp/maxmemory:2097152', 'r+b');
        fwrite($stream, $contents);
        rewind($stream);

        return $stream;
    }
}
