<?php

namespace Tests\Feature;

use App\Jobs\GenerateDataExportJob;
use App\Models\DataExportRequest;
use App\Models\User;
use App\Support\PrivateArtifact;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * El job de generación contra el formato vivo: documento por bloques que sale
 * publicado como artefacto por bloques, etapa rematada al terminar y el techo
 * operativo traducido al motivo que el panel conoce.
 */
final class DataExportGenerationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, mail_outbox, operational_metrics, audit_events RESTART IDENTITY CASCADE');
        Storage::fake('local');
    }

    public function test_the_job_publishes_a_chunked_artifact_and_clears_the_stage(): void
    {
        $user = User::factory()->create(['email_verified_at' => now()]);
        $request = DataExportRequest::create([
            'user_id' => $user->id,
            'security_version' => (int) $user->security_version,
            'status' => 'processing',
        ]);

        (new GenerateDataExportJob((int) $request->id))->handle();

        $request->refresh();
        $this->assertSame('ready', $request->status);
        $this->assertNull($request->stage, 'a terminal export must not keep a stale stage');
        $this->assertNotNull($request->artifact_path);

        $contents = (string) Storage::disk('local')->get((string) $request->artifact_path);
        $this->assertStringStartsWith(PrivateArtifact::HEADER."\n", $contents);

        $cipher = fopen('php://temp/maxmemory:2097152', 'r+b');
        fwrite($cipher, $contents);
        rewind($cipher);
        $plain = '';
        foreach (PrivateArtifact::readChunks($cipher) as $chunk) {
            $plain .= $chunk;
        }
        fclose($cipher);

        $decoded = json_decode($plain, true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame('uvh-account-export-v1', $decoded['format']);
        $this->assertSame($user->email, $decoded['account']['email']);
    }

    public function test_every_stage_is_persisted_in_order_through_the_lateral_connection(): void
    {
        // Regresión de la conexión lateral: `connectUsing` sin `force` lanza al
        // re-registrar el nombre y el `catch` de writeStage lo ocultaba, con lo
        // que el progreso se congelaba en `collecting`. La secuencia COMPLETA
        // debe llegar a la fila —una etapa por llamada, todas persistidas—.
        $user = User::factory()->create(['email_verified_at' => now()]);
        $request = DataExportRequest::create([
            'user_id' => $user->id,
            'security_version' => (int) $user->security_version,
            'status' => 'processing',
        ]);

        $stages = [];
        DB::listen(static function (QueryExecuted $query) use (&$stages): void {
            if ($query->connectionName !== 'export-stage') {
                return;
            }
            foreach ($query->bindings as $binding) {
                if (is_string($binding)
                    && in_array($binding, ['collecting', 'analytics', 'encoding', 'encrypting', 'finalizing'], true)) {
                    $stages[] = $binding;
                }
            }
        });

        (new GenerateDataExportJob((int) $request->id))->handle();

        $this->assertSame(
            ['collecting', 'analytics', 'encoding', 'encrypting', 'finalizing'],
            $stages,
            'every generation stage must be persisted exactly once, in order',
        );
        $request->refresh();
        $this->assertSame('ready', $request->status);
    }

    public function test_an_export_over_the_operational_ceiling_fails_with_the_size_reason(): void
    {
        config(['uvh.export_max_plaintext_bytes' => 1024]);
        $user = User::factory()->create(['email_verified_at' => now()]);
        $request = DataExportRequest::create([
            'user_id' => $user->id,
            'security_version' => (int) $user->security_version,
            'status' => 'processing',
        ]);

        (new GenerateDataExportJob((int) $request->id))->handle();

        $request->refresh();
        $this->assertSame('failed', $request->status);
        $this->assertSame('automated_size_limit', $request->failure_reason);
        $this->assertNull($request->stage);
        $this->assertNull($request->artifact_path);
        $this->assertSame([], Storage::disk('local')->files('account-exports'));
    }

    public function test_a_security_rotation_while_generating_invalidates_the_export(): void
    {
        $user = User::factory()->create(['email_verified_at' => now()]);
        $request = DataExportRequest::create([
            'user_id' => $user->id,
            'security_version' => (int) $user->security_version,
            'status' => 'processing',
        ]);
        // La rotación de credenciales invalida cualquier exportación en curso:
        // el artefacto no puede describir una cuenta que ya no es la misma.
        DB::table('users')->where('id', $user->id)->update(['security_version' => (int) $user->security_version + 1]);

        (new GenerateDataExportJob((int) $request->id))->handle();

        $request->refresh();
        $this->assertSame('cancelled', $request->status);
        $this->assertSame([], Storage::disk('local')->files('account-exports'));
    }
}
