<?php

namespace Tests\Feature;

use App\Models\DataExportRequest;
use App\Models\User;
use App\Support\PrivateArtifact;
use App\Support\SignedToken;
use App\Support\UvhCrypto;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** Contract tests for the overlap phase of an APP_SECRET rotation. */
final class AppSecretRotationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, data_export_requests, mail_outbox, webhooks, privacy_rights_messages, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        Storage::fake('local');
    }

    public function test_previous_key_reads_old_ciphertext_while_new_writes_use_current_key(): void
    {
        $oldSecret = 'oL7dS2eC9rE4tK8xY1pN6mV3bQ5wA0hJ7uF2iG9zR4cX';
        $newSecret = 'nE8wS3eC0rE5tK9xY2pN7mV4bQ6wA1hJ8uF3iG0zR5cX';

        config(['uvh.secret' => $oldSecret, 'uvh.secret_previous' => []]);
        $oldCiphertext = UvhCrypto::encryptAtRest('rotatable-value');
        $oldSignedToken = SignedToken::sign('unlock-context', 60_000);

        // During overlap every process writes with the new key but retains the
        // old key for reads and for short-lived signed tokens already issued.
        config(['uvh.secret' => $newSecret, 'uvh.secret_previous' => [$oldSecret]]);
        $this->assertSame('rotatable-value', UvhCrypto::decryptAtRest($oldCiphertext));
        $this->assertSame('unlock-context', SignedToken::verify($oldSignedToken));
        $this->assertFalse(UvhCrypto::encryptedWithCurrentKey($oldCiphertext));

        $newCiphertext = UvhCrypto::encryptAtRest('current-value');
        $this->assertTrue(UvhCrypto::encryptedWithCurrentKey($newCiphertext));
        $this->assertSame('current-value', UvhCrypto::decryptAtRest($newCiphertext));
    }

    public function test_the_rotation_reencrypts_chunked_export_artifacts_in_streaming(): void
    {
        // Un artefacto de exportación por bloques se recifra entero —bloque a
        // bloque— con la clave nueva, conserva cada byte de su documento y una
        // segunda pasada no lo toca si ya está con la clave actual.
        $oldSecret = 'oL7dS2eC9rE4tK8xY1pN6mV3bQ5wA0hJ7uF2iG9zR4cX';
        $newSecret = 'nE8wS3eC0rE5tK9xY2pN7mV4bQ6wA1hJ8uF3iG0zR5cX';
        config(['uvh.secret' => $oldSecret, 'uvh.secret_previous' => []]);

        $plain = str_repeat('0123456789abcdef', (9 * 1024 * 1024) / 16);
        $path = 'account-exports/'.str_repeat('R', 32).'.uvh';
        $in = fopen('php://temp/maxmemory:2097152', 'r+b');
        $this->assertIsResource($in);
        fwrite($in, $plain);
        rewind($in);
        PrivateArtifact::write($path, $in);
        fclose($in);
        $user = User::factory()->create();
        DataExportRequest::create([
            'user_id' => $user->id,
            'security_version' => (int) $user->security_version,
            'status' => 'ready',
            'download_expires_at' => now()->addHour(),
            'artifact_path' => $path,
            'ready_at' => now(),
        ]);

        config(['uvh.secret' => $newSecret, 'uvh.secret_previous' => [$oldSecret]]);
        $this->artisan('uvh:crypto:rotate')->assertSuccessful();

        $contents = (string) Storage::disk('local')->get($path);
        $this->assertGreaterThanOrEqual(2, substr_count($contents, 'enc:v1:'), 'the fixture must really span several blocks');
        $this->assertTrue(PrivateArtifact::encryptedWithCurrentKey($contents), 'every block must now use the current key');
        $cipher = fopen('php://temp/maxmemory:2097152', 'r+b');
        $this->assertIsResource($cipher);
        fwrite($cipher, $contents);
        rewind($cipher);
        $rebuilt = '';
        foreach (PrivateArtifact::readChunks($cipher) as $chunk) {
            $rebuilt .= $chunk;
        }
        fclose($cipher);
        $this->assertSame($plain, $rebuilt, 'the streamed re-encryption must preserve every byte of the document');

        // Segunda pasada: nada que recifrar, el artefacto no se reescribe.
        $this->artisan('uvh:crypto:rotate')->assertSuccessful();
        $this->assertSame($contents, (string) Storage::disk('local')->get($path));
    }

    public function test_old_ciphertext_fails_closed_after_previous_key_is_retired(): void
    {
        $oldSecret = 'oL7dS2eC9rE4tK8xY1pN6mV3bQ5wA0hJ7uF2iG9zR4cX';
        $newSecret = 'nE8wS3eC0rE5tK9xY2pN7mV4bQ6wA1hJ8uF3iG0zR5cX';

        config(['uvh.secret' => $oldSecret, 'uvh.secret_previous' => []]);
        $oldCiphertext = UvhCrypto::encryptAtRest('must-not-survive-retirement');
        config(['uvh.secret' => $newSecret, 'uvh.secret_previous' => []]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('At-rest decryption failed');
        UvhCrypto::decryptAtRest($oldCiphertext);
    }
}
