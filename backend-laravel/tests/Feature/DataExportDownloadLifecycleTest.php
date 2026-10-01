<?php

namespace Tests\Feature;

use App\Http\Controllers\AccountController;
use App\Models\DataExportRequest;
use App\Models\User;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\PrivateArtifact;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use App\Support\UvhRequest;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;
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
        DB::statement('TRUNCATE users, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        Queue::fake();
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
            $this->assertSame('{"account":{"email":"safe@example.test"}}', $response->streamedContent(), "download attempt {$attempt}");
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

    public function test_session_revoked_during_artifact_io_cannot_receive_the_download(): void
    {
        $user = $this->mfaUser();
        $export = $this->readyExport($user, '{"private":true}');
        $disk = Storage::disk('local');
        $proxy = \Mockery::mock($disk);
        $proxy->shouldReceive('readStream')->once()->with($export->artifact_path)
            ->andReturnUsing(function (string $path) use ($disk, $user) {
                // Revoking one session does not rotate the account generation.
                DB::table('sessions')->where('user_id', $user->id)->update(['revoked_at' => now()]);

                return $disk->readStream($path);
            });
        Storage::shouldReceive('disk')->with('local')->andReturn($proxy);

        $this->post('/api/v1/auth/data-export/download', $this->credentials())->assertStatus(409);
        $export->refresh();
        $this->assertSame('ready', $export->status);
        $this->assertNull($export->download_served_at);
        $this->assertSame((int) $user->security_version, (int) $user->refresh()->security_version);
    }

    public function test_only_the_session_that_downloaded_can_acknowledge_it(): void
    {
        // Sesión A sirve la descarga tras su step-up; sesión B —otra sesión de
        // la MISMA cuenta— no puede consumir ni borrar un artifact que nunca se
        // le entregó. La confirmación pertenece a la sesión que descargó.
        $user = $this->mfaUser();
        $request = $this->readyExport($user, '{"account":{"email":"safe@example.test"}}');
        $cookie = (string) config('session.cookie');
        $sessionA = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true);
        $this->withCookie($cookie, $sessionA);
        $this->post('/api/v1/auth/data-export/download', $this->credentials(self::RECOVERY))->assertOk();

        $sessionB = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true);
        $this->withCookie($cookie, $sessionB);
        $this->postJson('/api/v1/auth/data-export/download/acknowledge')
            ->assertStatus(409)->assertExactJson(['error' => 'Confirma la descarga desde la sesión que la realizó']);
        $request->refresh();
        $this->assertSame('ready', $request->status, 'another session must not consume the export');
        Storage::disk('local')->assertExists((string) $request->artifact_path);

        // La sesión que descargó sí la confirma.
        $this->withCookie($cookie, $sessionA);
        $this->postJson('/api/v1/auth/data-export/download/acknowledge')
            ->assertOk()->assertExactJson(['ok' => true]);
        $request->refresh();
        $this->assertSame('downloaded', $request->status);
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

    public function test_a_legacy_single_blob_artifact_still_serves(): void
    {
        // Artefactos emitidos antes del formato por bloques: un solo blob, y
        // el mismo cuerpo sale servido. La ventana de descarga dura 48 horas,
        // más corta que cualquier transición de formato.
        $user = $this->mfaUser();
        $path = 'account-exports/'.str_repeat('C', 32).'.uvh';
        Storage::disk('local')->put($path, UvhCrypto::encryptAtRest('{"format":"legacy-blob"}'));
        DataExportRequest::create([
            'user_id' => $user->id,
            'security_version' => (int) $user->security_version,
            'status' => 'ready',
            'mail_generation_hash' => Ids::sha256Hex(Ids::randomToken(32)),
            'download_expires_at' => now()->addHour(),
            'artifact_path' => $path,
            'ready_at' => now(),
        ]);

        $response = $this->post('/api/v1/auth/data-export/download', $this->credentials());
        $response->assertOk();
        $this->assertSame('{"format":"legacy-blob"}', $response->streamedContent());
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

    public function test_the_status_exposes_the_live_stage_only_while_processing(): void
    {
        $user = $this->mfaUser();
        $row = DataExportRequest::create([
            'user_id' => $user->id,
            'security_version' => (int) $user->security_version,
            'status' => 'processing',
            'stage' => 'analytics',
        ]);

        $this->getJson('/api/v1/auth/data-export')->assertOk()
            ->assertJsonPath('export.status', 'processing')
            ->assertJsonPath('export.stage', 'analytics');

        // La etapa es progreso de una generación viva; al terminar, la última
        // etapa junto a un estado terminal sería una historia falsa.
        DB::table('data_export_requests')->where('id', $row->id)->update([
            'status' => 'ready',
            'stage' => null,
            'download_expires_at' => now()->addHour(),
            'ready_at' => now(),
        ]);
        $this->getJson('/api/v1/auth/data-export')->assertOk()
            ->assertJsonPath('export.status', 'ready')
            ->assertJsonPath('export.stage', null);
    }

    public function test_the_history_lists_recent_exports_without_plumbing(): void
    {
        $user = $this->mfaUser();
        foreach (range(1, 12) as $ignored) {
            DataExportRequest::create([
                'user_id' => $user->id,
                'security_version' => (int) $user->security_version,
                'status' => 'downloaded',
                'mail_generation_hash' => Ids::sha256Hex(Ids::randomToken(32)),
                'artifact_path' => 'account-exports/'.str_repeat('D', 32).'.uvh',
                'downloaded_at' => now(),
            ]);
        }

        $exports = $this->getJson('/api/v1/auth/data-export/history')->assertOk()->json('exports');
        $this->assertIsArray($exports);
        $this->assertCount(10, $exports, 'the history is bounded to the last ten exports');
        foreach ($exports as $entry) {
            $this->assertSame('downloaded', $entry['status']);
            $this->assertArrayNotHasKey('artifactPath', $entry);
            $this->assertArrayNotHasKey('mailGenerationHash', $entry);
        }

        // El historial es sólo lectura: no toca la exportación que describe.
        $this->assertSame(12, DB::table('data_export_requests')->where('user_id', $user->id)->count());
    }

    public static function exportActors(): array
    {
        $cases = [];
        foreach (['request', 'cancel', 'download', 'acknowledge'] as $action) {
            foreach (['expired', 'revoked', 'version'] as $reason) {
                $cases[$action.' '.$reason] = [$action, $reason];
            }
        }

        return $cases;
    }

    #[DataProvider('exportActors')]
    public function test_export_mutations_revalidate_the_pre_authorized_session(string $action, string $reason): void
    {
        $user = $this->mfaUser();
        $snapshot = clone $user;
        $sessionId = DB::table('sessions')->where('user_id', $user->id)->value('id');
        $export = $action === 'request' ? null : $this->readyExport($user, '{"private":true}');
        if ($export) {
            $export->update(['download_served_at' => now(), 'download_served_session_id' => $sessionId]);
        }
        if ($reason === 'version') {
            DB::table('users')->where('id', $user->id)->update(['security_version' => 2]);
            DB::table('sessions')->where('id', $sessionId)->update(['security_version' => 2]);
            $export?->update(['security_version' => 2]);
        } else {
            DB::table('sessions')->where('id', $sessionId)->update($reason === 'revoked' ? ['revoked_at' => now()] : ['expires_at' => now()->subSecond()]);
        }
        $before = DB::table('data_export_requests')->orderBy('id')->get()->toJson();
        $codes = $user->refresh()->recovery_codes;
        $request = Request::create('/', 'POST', $this->credentials());
        $request->attributes->set(UvhRequest::USER, $snapshot);
        $request->attributes->set(UvhRequest::SESSION_ID, $sessionId);
        $controller = app(AccountController::class);
        $response = match ($action) {
            'request' => $controller->requestExport($request),
            'cancel' => $controller->cancelExport($request),
            'download' => $controller->downloadExport($request),
            'acknowledge' => $controller->acknowledgeExportDownload($request),
        };
        $this->assertGreaterThanOrEqual(400, $response->getStatusCode());
        $this->assertLessThan(500, $response->getStatusCode());
        $this->assertSame($before, DB::table('data_export_requests')->orderBy('id')->get()->toJson());
        $this->assertSame($codes, $user->refresh()->recovery_codes);
        if ($export) {
            Storage::disk('local')->assertExists($export->artifact_path);
        }
        Queue::assertNothingPushed();
    }

    public static function exportAudits(): array
    {
        $cases = [];
        foreach (['request', 'cancel', 'download', 'acknowledge'] as $action) {
            $cases[$action.' exact admission fails'] = [$action, true];
            $cases[$action.' history fails'] = [$action, false];
        }

        return $cases;
    }

    #[DataProvider('exportAudits')]
    public function test_export_mutations_admit_the_exact_audit_with_the_state_change(string $action, bool $fail): void
    {
        $user = $this->mfaUser();
        $sessionId = DB::table('sessions')->where('user_id', $user->id)->value('id');
        $export = $action === 'request' ? null : $this->readyExport($user, '{"private":true}');
        if ($action === 'acknowledge') {
            $export->update(['download_served_at' => now(), 'download_served_session_id' => $sessionId]);
        }
        $event = match ($action) {
            'request' => 'account.data_export_requested', 'cancel' => 'account.data_export_cancelled',
            'download' => 'account.data_export_served', 'acknowledge' => 'account.data_export_downloaded',
        };
        if ($fail) {
            DB::listen(static function (QueryExecuted $query) use ($event): void {
                if (! str_starts_with(strtolower($query->sql), 'insert') || ! str_contains($query->sql, '"audit_outbox"')) {
                    return;
                }
                foreach ($query->bindings as $binding) {
                    $row = is_string($binding) ? json_decode($binding, true) : null;
                    if (is_array($row) && ($row['action'] ?? null) === $event) {
                        throw new \RuntimeException('Fixture: exact export audit admission unavailable');
                    }
                }
            });
        } else {
            Schema::rename('audit_events', 'audit_events_unavailable');
        }
        try {
            $url = '/api/v1/auth/data-export'.match ($action) {
                'request' => '', 'cancel' => '/cancel', 'download' => '/download', 'acknowledge' => '/download/acknowledge'
            };
            $response = $this->post($url, $this->credentials());
            if ($fail) {
                $response->assertServerError();
                if ($export) {
                    $this->assertSame('ready', $export->refresh()->status);
                    Storage::disk('local')->assertExists($export->artifact_path);
                    if ($action === 'download') {
                        $this->assertNull($export->download_served_at);
                    }
                } else {
                    $this->assertDatabaseCount('data_export_requests', 0);
                    $this->assertCount(2, $user->refresh()->recovery_codes);
                }
                Queue::assertNothingPushed();
            } else {
                $response->assertSuccessful();
                $pending = DB::table('audit_outbox')->get()->map(static fn ($row) => json_decode($row->event, true, flags: JSON_THROW_ON_ERROR));
                $exact = $pending->where('action', $event)->values();
                $this->assertCount(1, $exact);
                $this->assertSame($user->id, $exact[0]['user_id']);
                $this->assertSame((string) ($export?->id ?? $response->json('export.id')), $exact[0]['resource_id']);
                $serialized = json_encode($exact[0], JSON_THROW_ON_ERROR);
                $this->assertStringNotContainsString(self::PASSWORD, $serialized);
                $this->assertStringNotContainsString(self::RECOVERY, $serialized);
            }
        } finally {
            if (! $fail) {
                Schema::rename('audit_events_unavailable', 'audit_events');
            }
        }
        if (! $fail) {
            $this->assertTrue(Audit::drain());
            $this->assertTrue(Audit::drain());
            $this->assertSame(1, DB::table('audit_events')->where('action', $event)->count());
            $this->assertDatabaseCount('audit_outbox', 0);
        }
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
        // El formato vivo: contenedor por bloques, como lo escribe el job.
        $path = 'account-exports/'.str_repeat('B', 32).'.uvh';
        $plain = fopen('php://temp/maxmemory:2097152', 'r+b');
        fwrite($plain, $json);
        rewind($plain);
        PrivateArtifact::write($path, $plain);
        fclose($plain);

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
