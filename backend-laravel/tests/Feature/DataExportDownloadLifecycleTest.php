<?php

namespace Tests\Feature;

use App\Models\DataExportRequest;
use App\Models\User;
use App\Support\Ids;
use App\Support\UvhCrypto;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** Isolated regression coverage for the served/acknowledged export boundary. */
final class DataExportDownloadLifecycleTest extends TestCase
{
    private const CSRF = 'export-download-csrf';

    private const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users RESTART IDENTITY CASCADE');
        Storage::fake('local');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', self::CSRF)->withHeader('X-CSRF-Token', self::CSRF);
    }

    public function test_download_remains_retryable_until_the_browser_acknowledges_it(): void
    {
        $request = $this->readyExport('{"account":{"email":"safe@example.test"}}');

        foreach ([1, 2] as $attempt) {
            $response = $this->post('/api/v1/auth/data-export/download', ['token' => self::TOKEN]);
            $response->assertOk();
            // Symfony may reorder directives; assert the cache policy rather
            // than its textual serialization order.
            $this->assertTrue($response->headers->hasCacheControlDirective('private'));
            $this->assertTrue($response->headers->hasCacheControlDirective('no-store'));
            $this->assertTrue($response->headers->hasCacheControlDirective('no-cache'));
            $this->assertSame('0', (string) $response->headers->getCacheControlDirective('max-age'));
            $this->assertSame('{"account":{"email":"safe@example.test"}}', $response->getContent(), "download attempt {$attempt}");
            $request->refresh();
            $this->assertSame('ready', $request->status);
            $this->assertSame(Ids::sha256Hex(self::TOKEN), $request->download_token_hash);
            $this->assertNotNull($request->download_served_at);
            Storage::disk('local')->assertExists((string) $request->artifact_path);
        }

        $this->postJson('/api/v1/auth/data-export/download/acknowledge', ['token' => self::TOKEN])
            ->assertOk()->assertExactJson(['ok' => true]);

        $request->refresh();
        $this->assertSame('downloaded', $request->status);
        $this->assertNull($request->download_token_hash);
        $this->assertNull($request->artifact_path);
        $this->assertNotNull($request->downloaded_at);
        Storage::disk('local')->assertMissing('account-exports/'.str_repeat('B', 32).'.uvh');
    }

    public function test_acknowledgement_cannot_consume_an_export_that_was_never_served(): void
    {
        $request = $this->readyExport('{}');

        $this->postJson('/api/v1/auth/data-export/download/acknowledge', ['token' => self::TOKEN])
            ->assertStatus(409)->assertExactJson(['error' => 'La exportación todavía no se ha servido']);

        $request->refresh();
        $this->assertSame('ready', $request->status);
        $this->assertSame(Ids::sha256Hex(self::TOKEN), $request->download_token_hash);
        Storage::disk('local')->assertExists((string) $request->artifact_path);
    }

    private function readyExport(string $json): DataExportRequest
    {
        $user = User::factory()->create();
        $path = 'account-exports/'.str_repeat('B', 32).'.uvh';
        Storage::disk('local')->put($path, UvhCrypto::encryptAtRest($json));

        return DataExportRequest::create([
            'user_id' => $user->id,
            'security_version' => $user->security_version,
            'status' => 'ready',
            'download_token_hash' => Ids::sha256Hex(self::TOKEN),
            'download_expires_at' => now()->addHour(),
            'artifact_path' => $path,
            'ready_at' => now(),
        ]);
    }
}
