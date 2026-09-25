<?php

namespace Tests\Feature;

use App\Models\DataExportRequest;
use App\Models\User;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Isolated regression coverage for the served/acknowledged export boundary.
 *
 * La descarga la autorizan la sesión y un step-up reciente: la exportación
 * pertenece a la cuenta y el artefacto se entrega sólo a quien acaba de
 * demostrar la contraseña y el segundo factor. La solicitud se consume cuando
 * el navegador acusa la recepción completa, no antes.
 */
final class DataExportDownloadLifecycleTest extends TestCase
{
    private const CSRF = 'export-download-csrf';

    private const PASSWORD = 'tiovivo-cobrizo-astilla-42';

    private const RECOVERY = 'ABCD2345EFGH6789';

    /** Each step-up spends one single-use code; a retry must bring its own. */
    private const RECOVERY_SECOND = 'ZW8X7Y6V5U4T3S2R';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users RESTART IDENTITY CASCADE');
        Storage::fake('local');
        config(['cache.default' => 'array']);
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', self::CSRF)->withHeader('X-CSRF-Token', self::CSRF);
    }

    public function test_download_remains_retryable_until_the_browser_acknowledges_it(): void
    {
        $user = $this->mfaUser();
        $request = $this->readyExport($user, '{"account":{"email":"safe@example.test"}}');

        $factorCodes = [self::RECOVERY, self::RECOVERY_SECOND];
        foreach ([1, 2] as $attempt) {
            $response = $this->post('/api/v1/auth/data-export/download', $this->credentials($factorCodes[$attempt - 1]));
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
            $this->assertNotNull($request->download_served_at);
            Storage::disk('local')->assertExists((string) $request->artifact_path);
        }

        $this->postJson('/api/v1/auth/data-export/download/acknowledge')
            ->assertOk()->assertExactJson(['ok' => true]);

        $request->refresh();
        $this->assertSame('downloaded', $request->status);
        $this->assertNull($request->artifact_path);
        $this->assertNotNull($request->downloaded_at);
        // Every serve spent exactly one recovery code and nothing more.
        $this->assertSame([], $user->refresh()->recovery_codes);
        Storage::disk('local')->assertMissing('account-exports/'.str_repeat('B', 32).'.uvh');
    }

    public function test_acknowledgement_cannot_consume_an_export_that_was_never_served(): void
    {
        $user = $this->mfaUser();
        $request = $this->readyExport($user, '{}');

        $this->postJson('/api/v1/auth/data-export/download/acknowledge')
            ->assertStatus(409)->assertExactJson(['error' => 'La exportación todavía no se ha servido']);

        $request->refresh();
        $this->assertSame('ready', $request->status);
        Storage::disk('local')->assertExists((string) $request->artifact_path);
    }

    public function test_a_wrong_password_never_reaches_the_artifact(): void
    {
        $user = $this->mfaUser();
        $request = $this->readyExport($user, '{"account":{}}');

        $this->post('/api/v1/auth/data-export/download', array_merge($this->credentials(), ['password' => 'contraseña-equivocada']))
            ->assertStatus(403)->assertExactJson(['error' => 'Contraseña incorrecta']);

        $request->refresh();
        $this->assertSame('ready', $request->status);
        $this->assertNull($request->download_served_at);
        // A failed step-up spends nothing but the attempt budget.
        $this->assertSame(
            array_map([Ids::class, 'sha256Hex'], [self::RECOVERY, self::RECOVERY_SECOND]),
            $user->refresh()->recovery_codes,
        );
        Storage::disk('local')->assertExists((string) $request->artifact_path);
    }

    public function test_the_step_up_is_mandatory(): void
    {
        $user = $this->mfaUser();
        $this->readyExport($user, '{}');

        $this->postJson('/api/v1/auth/data-export/download', [])
            ->assertStatus(422)->assertExactJson(['error' => 'Datos inválidos']);
    }

    public function test_an_expired_export_is_refused_and_cleaned(): void
    {
        $user = $this->mfaUser();
        $request = $this->readyExport($user, '{}');
        $path = (string) $request->artifact_path;
        DB::table('data_export_requests')->where('id', $request->id)
            ->update(['download_expires_at' => now()->subMinute()]);

        $this->post('/api/v1/auth/data-export/download', $this->credentials())
            ->assertStatus(400)->assertExactJson(['error' => 'La exportación ha caducado. Solicita una nueva desde Ajustes']);

        $request->refresh();
        $this->assertSame('expired', $request->status);
        $this->assertNull($request->artifact_path);
        Storage::disk('local')->assertMissing($path);
    }

    public function test_the_status_payload_names_the_failure_reason_and_hides_plumbing(): void
    {
        $user = $this->mfaUser();
        DataExportRequest::create([
            'user_id' => $user->id,
            'security_version' => (int) $user->security_version,
            'status' => 'failed',
            'failure_reason' => 'automated_size_limit',
            'mail_generation_hash' => Ids::sha256Hex(Ids::randomToken(32)),
        ]);

        $this->getJson('/api/v1/auth/data-export')->assertOk()
            ->assertJsonPath('export.status', 'failed')
            ->assertJsonPath('export.failureReason', 'automated_size_limit')
            ->assertJsonMissingPath('export.mailGenerationHash')
            ->assertJsonMissingPath('export.artifactPath')
            ->assertJsonMissingPath('export.confirmationExpiresAt');
    }

    /** @return array{password: string, factorCode: string} */
    private function credentials(string $factorCode = self::RECOVERY): array
    {
        return ['password' => self::PASSWORD, 'factorCode' => $factorCode];
    }

    private function mfaUser(): User
    {
        $user = User::factory()->create([
            'password_hash' => Hash::make(self::PASSWORD),
            'email_verified_at' => now(),
        ]);
        $user->forceFill([
            'mfa_enabled' => true,
            'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP'),
            'recovery_codes' => array_map([Ids::class, 'sha256Hex'], [self::RECOVERY, self::RECOVERY_SECOND]),
        ])->save();

        // The step-up demands a fresh MFA window, exactly as the request does.
        $this->withCookie((string) config('session.cookie'), SessionManager::create(
            $user->id,
            Request::create('/'),
            (int) $user->refresh()->security_version,
            true,
        ));

        return $user->refresh();
    }

    private function readyExport(User $user, string $json): DataExportRequest
    {
        $path = 'account-exports/'.str_repeat('B', 32).'.uvh';
        Storage::disk('local')->put($path, UvhCrypto::encryptAtRest($json));

        return DataExportRequest::create([
            'user_id' => $user->id,
            'security_version' => (int) $user->security_version,
            'status' => 'ready',
            'mail_generation_hash' => Ids::sha256Hex(Ids::randomToken(32)),
            'download_expires_at' => now()->addHour(),
            'artifact_path' => $path,
            'ready_at' => now(),
        ]);
    }
}
