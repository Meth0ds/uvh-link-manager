<?php

namespace Tests\Feature;

use App\Support\PrivateArtifact;
use App\Support\UvhCrypto;
use Illuminate\Support\Facades\Storage;
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
        while (($line = fgets($scan)) !== false) {
            $line = rtrim($line, "\n");
            if ($lines === 0) {
                $this->assertSame(PrivateArtifact::HEADER, $line);
            } else {
                $this->assertTrue(UvhCrypto::isAtRestCiphertext($line));
                $this->assertTrue(UvhCrypto::encryptedWithCurrentKey($line));
            }
            $lines += 1;
        }
        fclose($scan);
        $this->assertSame(1 + (int) ceil(strlen($plain) / PrivateArtifact::CHUNK_BYTES), $lines);

        $cipher = fopen($artifact, 'rb');
        $this->assertIsResource($cipher);
        PrivateArtifact::validate($cipher);
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

    /** @return resource */
    private function streamOf(string $contents)
    {
        $stream = fopen('php://temp/maxmemory:2097152', 'r+b');
        fwrite($stream, $contents);
        rewind($stream);

        return $stream;
    }
}
