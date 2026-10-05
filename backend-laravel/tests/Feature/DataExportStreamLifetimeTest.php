<?php

namespace Tests\Feature;

use App\Models\DataExportRequest;
use App\Models\User;
use App\Support\Ids;
use App\Support\PrivateArtifact;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Fixtures\ExportIoStream;
use Tests\TestCase;

/** Real HTTP/step-up/crypto boundaries; retained handles prove closure after errors. */
final class DataExportStreamLifetimeTest extends TestCase
{
    private const PASSWORD = 'fixture-export-resource-password';

    private const FIRST = 'ABCD2345EFGH6789';

    private const SECOND = 'ZW8X7Y6V5U4T3S2R';

    private const PATH = 'account-exports/DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD.uvh';

    private const BODY = '{"fixture":"stored export"}';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox, mail_outbox, operational_metrics RESTART IDENTITY CASCADE');
        Storage::fake('local');
        Queue::fake();
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'stream-lifetime-csrf')->withHeader('X-CSRF-Token', 'stream-lifetime-csrf');
    }

    private function fixture(): array
    {
        $user = User::factory()->create([
            'password_hash' => Hash::make(self::PASSWORD), 'mfa_enabled' => true,
            'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP'),
            'recovery_codes' => array_map([Ids::class, 'sha256Hex'], [self::FIRST, self::SECOND]),
        ]);
        $raw = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true);
        $this->withCookie((string) config('session.cookie'), $raw);
        $plain = $this->stream(self::BODY);
        PrivateArtifact::write(self::PATH, $plain);
        fclose($plain);
        $row = DataExportRequest::create([
            'user_id' => $user->id, 'security_version' => (int) $user->security_version,
            'status' => 'ready', 'artifact_path' => self::PATH, 'ready_at' => now(),
            'download_expires_at' => now()->addHour(),
        ]);

        return [$user, $row, Ids::sha256Hex($raw)];
    }

    /** @return resource */
    private function stream(string $value)
    {
        $stream = fopen('php://temp', 'r+b');
        fwrite($stream, $value);
        rewind($stream);

        return $stream;
    }

    private function download(string $factor = self::FIRST)
    {
        return $this->post('/api/v1/auth/data-export/download', ['password' => self::PASSWORD, 'factorCode' => $factor]);
    }

    public static function preparationErrors(): array
    {
        return [['plaintext'], ['unknown-header'], ['missing-footer'], ['invalid-footer'], ['invalid-resource'], ['open-error']];
    }

    #[DataProvider('preparationErrors')]
    public function test_preparation_error_closes_its_resource_without_consuming_the_export(string $fault): void
    {
        [$user, $row] = $this->fixture();
        $disk = Storage::disk('local');
        $captured = null;
        $intercept = true;
        $proxy = \Mockery::mock($disk);
        $proxy->shouldReceive('readStream')->with(self::PATH)->andReturnUsing(function (string $path) use ($fault, $disk, &$captured, &$intercept) {
            if (! $intercept) {
                return $disk->readStream($path);
            }
            if ($fault === 'open-error') {
                throw new \RuntimeException('Fixture: private volume unavailable');
            }
            if ($fault === 'invalid-resource') {
                return false;
            }
            $blob = match ($fault) {
                'plaintext' => 'PRIVATE-FIXTURE-DO-NOT-LOG',
                'unknown-header' => "uvh-private-artifact-v9\n",
                'missing-footer' => PrivateArtifact::HEADER."\n".UvhCrypto::encryptAtRest('first')."\n",
                'invalid-footer' => PrivateArtifact::HEADER."\n".UvhCrypto::encryptAtRest('first')."\nend:not-ciphertext\n",
            };
            $captured = $this->stream($blob);

            return $captured;
        });
        Storage::shouldReceive('disk')->with('local')->andReturn($proxy);
        try {
            $response = $this->download();
            $response->assertStatus(503)->assertJsonStructure(['error']);
            $this->assertStringNotContainsString('PRIVATE-FIXTURE-DO-NOT-LOG', $response->getContent());
            $this->assertSame('ready', $row->refresh()->status);
            $this->assertNull($row->download_served_at);
            $this->assertNull($row->downloaded_at);
            $this->assertSame([Ids::sha256Hex(self::SECOND)], $user->refresh()->recovery_codes);
            $this->assertSame(0, DB::table('audit_events')->where('action', 'account.data_export_served')->count());
            $this->assertFalse(is_resource($captured), 'Every opened download resource must close even when validation throws');
            $intercept = false;
            $this->assertSame(self::BODY, $this->download(self::SECOND)->assertOk()->streamedContent());
            $this->assertSame('ready', $row->refresh()->status);
            $this->assertTrue($disk->exists(self::PATH));
            $this->assertDatabaseCount('mail_outbox', 0);
        } finally {
            if (is_resource($captured)) {
                fclose($captured);
            }
        }
    }

    public static function deliveries(): array
    {
        return [['v3'], ['v2'], ['legacy'], ['v3-corrupt'], ['v2-corrupt'], ['legacy-corrupt'], ['read-error']];
    }

    #[DataProvider('deliveries')]
    public function test_delivery_closes_its_resource_and_preserves_retryability_when_a_chunk_fails(string $format): void
    {
        [$user, $row, $sessionId] = $this->fixture();
        $pieces = ['{"fixture":"first', 'second', 'last"}'];
        $body = implode('', $pieces);
        $lines = array_map([UvhCrypto::class, 'encryptAtRest'], $pieces);
        $corrupt = str_contains($format, 'corrupt') || $format === 'read-error';
        $disk = Storage::disk('local');
        if ($format === 'read-error') {
            stream_wrapper_register('uvh-download-read-failure', ExportIoStream::class);
            ExportIoStream::$initialContents = PrivateArtifact::HEADER_V2."\n".$lines[0]."\n";
            ExportIoStream::$readFailureAfter = strlen(ExportIoStream::$initialContents);
            ExportIoStream::$denyRewind = false;
            $captured = fopen('uvh-download-read-failure://source', 'rb');
        } else {
            if ($corrupt) {
                $lines[2] = 'enc:v1:invalid-fixture-ciphertext';
            }
            $blob = match ($format) {
                'v3', 'v3-corrupt' => PrivateArtifact::HEADER."\n".implode("\n", $lines)."\n".PrivateArtifact::FOOTER_PREFIX.UvhCrypto::encryptAtRest(json_encode(['chunks' => 3, 'plaintextBytes' => strlen($body), 'sha256' => hash('sha256', $body)], JSON_THROW_ON_ERROR))."\n",
                'v2', 'v2-corrupt' => PrivateArtifact::HEADER_V2."\n".implode("\n", $lines)."\n",
                'legacy' => UvhCrypto::encryptAtRest($body),
                'legacy-corrupt' => 'enc:v1:invalid-fixture-ciphertext',
            };
            $captured = $this->stream($blob);
        }
        $proxy = \Mockery::mock($disk);
        $intercept = true;
        $proxy->shouldReceive('readStream')->with(self::PATH)->andReturnUsing(static function (string $path) use ($captured, $disk, &$intercept) {
            return $intercept ? $captured : $disk->readStream($path);
        });
        Storage::shouldReceive('disk')->with('local')->andReturn($proxy);
        try {
            $response = $this->download()->assertOk();
            $thrown = null;
            ob_start();
            try {
                $response->baseResponse->sendContent();
            } catch (\Throwable $error) {
                $thrown = $error;
            } finally {
                $received = (string) ob_get_clean();
            }
            if ($corrupt) {
                $this->assertNotNull($thrown, 'A corrupt or interrupted body must remain a failed delivery');
                $this->assertNotSame($body, $received);
                if (str_starts_with($format, 'v3')) {
                    $this->assertLessThan((int) $response->headers->get('Content-Length'), strlen($received));
                }
            } else {
                $this->assertNull($thrown);
                $this->assertSame($body, $received);
            }
            $this->assertFalse(is_resource($captured), 'Body exceptions must close the private input resource');
            $this->assertSame('ready', $row->refresh()->status);
            $this->assertNotNull($row->download_served_at, 'Served preparation committed before body delivery');
            $this->assertSame($sessionId, $row->download_served_session_id);
            $this->assertNull($row->downloaded_at);
            $this->assertSame([Ids::sha256Hex(self::SECOND)], $user->refresh()->recovery_codes);
            $this->assertSame(1, DB::table('audit_events')->where('action', 'account.data_export_served')->count());
            $this->assertTrue($disk->exists(self::PATH));
            $intercept = false;
            $this->assertSame(self::BODY, $this->download(self::SECOND)->assertOk()->streamedContent());
            $this->postJson('/api/v1/auth/data-export/download/acknowledge')->assertOk();
            $this->assertSame('downloaded', $row->refresh()->status);
            $this->assertFalse($disk->exists(self::PATH));
        } finally {
            if (is_resource($captured)) {
                fclose($captured);
            }
            if ($format === 'read-error') {
                stream_wrapper_unregister('uvh-download-read-failure');
                ExportIoStream::$readFailureAfter = null;
                ExportIoStream::$initialContents = '';
                ExportIoStream::$denyRewind = false;
            }
        }
    }
}
