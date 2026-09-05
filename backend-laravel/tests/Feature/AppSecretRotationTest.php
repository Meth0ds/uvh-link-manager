<?php

namespace Tests\Feature;

use App\Support\SignedToken;
use App\Support\UvhCrypto;
use Tests\TestCase;

/** Contract tests for the overlap phase of an APP_SECRET rotation. */
final class AppSecretRotationTest extends TestCase
{
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
