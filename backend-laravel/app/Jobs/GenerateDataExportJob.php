<?php

namespace App\Jobs;

use App\Models\DataExportRequest;
use App\Models\User;
use App\Support\AccountExportDocument;
use App\Support\Audit;
use App\Support\ExportTooLarge;
use App\Support\Ids;
use App\Support\NotificationInbox;
use App\Support\NotificationKinds;
use App\Support\OperationalMetrics;
use App\Support\PrivateArtifact;
use App\Support\PrivateArtifactCleanup;
use App\Support\UvhMail;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Support\Facades\DB;

class GenerateDataExportJob implements ShouldQueue
{
    use Dispatchable;
    use Queueable;

    public int $tries = 3;

    /**
     * Por debajo del worker (`queue-exports`, 660 s) y éste por debajo del
     * `retry_after` del broker (900 s): el job avisa de su propia muerte antes
     * de que el worker lo corte, y el broker no reparte el trabajo a un
     * segundo worker mientras el primero sigue en él. La generación por
     * bloques sostiene cuentas grandes dentro de este presupuesto sin el límite
     * de filas ni el de 12 MiB de antes.
     */
    public int $timeout = 600;

    /** @var array<int, int> */
    public array $backoff = [60, 300];

    /**
     * How long a ready file stays available. Short on purpose: it is a private
     * artifact, and the owner is told the exact date in the notice.
     */
    private const DOWNLOAD_TTL_DAYS = 2;

    private const REQUIRED_MEMORY_HEADROOM = 96 * 1024 * 1024;

    public function __construct(public readonly int $requestId)
    {
        $this->onQueue('exports');
    }

    public function handle(): void
    {
        $snapshot = DataExportRequest::where('id', $this->requestId)
            ->where('status', 'processing')->first(['id', 'user_id']);
        if (! $snapshot) {
            return;
        }

        // Persist the randomized path before writing. A worker crash can then
        // be recovered by housekeeping even if no byte reached the volume.
        $artifactPath = 'account-exports/'.Ids::randomToken(24).'.uvh';
        $start = DB::transaction(function () use ($snapshot): array {
            $user = User::where('id', $snapshot->user_id)->lockForUpdate()->first();
            $request = DataExportRequest::where('id', $snapshot->id)
                ->where('user_id', $snapshot->user_id)->lockForUpdate()->first();
            if (! $request || $request->status !== 'processing') {
                return ['status' => 'stale', 'path' => null];
            }
            $oldPath = is_string($request->artifact_path) && $request->artifact_path !== ''
                ? $request->artifact_path
                : null;
            if (! $user || $user->deleted_at
                || (int) $user->security_version !== (int) $request->security_version) {
                $request->update(['status' => 'cancelled', 'stage' => null]);

                return ['status' => 'cancelled', 'path' => $oldPath];
            }

            return [
                'status' => 'ok',
                'path' => $oldPath,
                'user_id' => (int) $user->id,
                'request_id' => (int) $request->id,
            ];
        });
        if (is_string($start['path']) && $start['path'] !== '') {
            $cleaned = PrivateArtifactCleanup::attempt((int) $snapshot->id, $start['path']);
            if ($start['status'] === 'ok' && ! $cleaned) {
                throw new \RuntimeException('Previous private export artifact could not be cleaned');
            }
        }
        if ($start['status'] !== 'ok') {
            return;
        }

        $userId = $start['user_id'];
        $requestId = $start['request_id'];

        $registered = DB::transaction(function () use ($requestId, $userId, $artifactPath): bool {
            $lockedUser = User::where('id', $userId)->lockForUpdate()->first();
            $lockedRequest = DataExportRequest::where('id', $requestId)
                ->where('user_id', $userId)->lockForUpdate()->first();
            if (! $lockedRequest || $lockedRequest->status !== 'processing' || ! $lockedUser
                || $lockedUser->deleted_at
                || (int) $lockedUser->security_version !== (int) $lockedRequest->security_version
                || $lockedRequest->artifact_path !== null) {
                return false;
            }
            $lockedRequest->update(['artifact_path' => $artifactPath, 'stage' => 'collecting', 'updated_at' => now()]);

            return true;
        });
        if (! $registered) {
            return;
        }

        // El documento se construye por bloques con memoria acotada
        // (`AccountExportDocument`): ya no hay presupuesto de filas ni tope de
        // 12 MiB que convierta a una cuenta grande en «contacta soporte». El
        // suelo de memoria que queda es sólo el seguro del proceso contra un
        // OOM inminente; con la generación por bloques su tamaño ya no depende
        // del de la cuenta.
        try {
            if (! $this->hasMemoryHeadroom(self::REQUIRED_MEMORY_HEADROOM)) {
                OperationalMetrics::increment('export.memory_budget_rejected');
                $this->failTooLarge($userId, $requestId, $artifactPath);

                return;
            }

            $plain = fopen('php://temp/maxmemory:8388608', 'r+b');
            if (! is_resource($plain)) {
                throw new \RuntimeException('Could not open the export document spool');
            }
            try {
                AccountExportDocument::render($userId, $plain, function (string $phase) use ($userId, $requestId): void {
                    $this->writeStage($userId, $requestId, $phase);
                });
                $this->writeStage($userId, $requestId, 'encrypting');
                rewind($plain);
                PrivateArtifact::write($artifactPath, $plain);
            } finally {
                fclose($plain);
            }
        } catch (ExportTooLarge) {
            OperationalMetrics::increment('export.too_large');
            $this->failTooLarge($userId, $requestId, $artifactPath);

            return;
        } catch (\Throwable) {
            PrivateArtifactCleanup::attempt($requestId, $artifactPath);
            throw new \RuntimeException('No se pudo generar la exportación de datos');
        }

        try {
            // Recheck the account/request after generation. A password/email/MFA
            // rotation while the job was running invalidates this export.
            $eligible = DB::transaction(function () use ($requestId, $userId, $artifactPath): bool {
                $lockedUser = User::where('id', $userId)->lockForUpdate()->first();
                $lockedRequest = DataExportRequest::where('id', $requestId)
                    ->where('user_id', $userId)->lockForUpdate()->first();
                if ($lockedRequest?->status !== 'processing' || ! $lockedUser
                    || $lockedUser->deleted_at
                    || (int) $lockedUser->security_version !== (int) $lockedRequest->security_version
                    || ! is_string($lockedRequest->artifact_path)
                    || ! hash_equals($artifactPath, $lockedRequest->artifact_path)) {
                    return false;
                }

                return true;
            });
            if (! $eligible) {
                PrivateArtifactCleanup::attempt($requestId, $artifactPath);

                return;
            }

            $this->writeStage($userId, $requestId, 'finalizing');

            // The notice announces the file and names the section that serves
            // it. It carries no authority of its own: downloads are authorised
            // by the session plus a fresh step-up.
            $mailGeneration = Ids::sha256Hex(Ids::randomToken(32));
            $url = rtrim((string) config('app.url'), '/').'/app/settings/privacy';
            $madeReady = DB::transaction(function () use ($requestId, $userId, $artifactPath, $mailGeneration, $url): bool {
                $lockedUser = User::where('id', $userId)->lockForUpdate()->first();
                $lockedRequest = DataExportRequest::where('id', $requestId)
                    ->where('user_id', $userId)->lockForUpdate()->first();
                if (! $lockedRequest || $lockedRequest->status !== 'processing' || ! $lockedUser
                    || $lockedUser->deleted_at
                    || (int) $lockedUser->security_version !== (int) $lockedRequest->security_version
                    || ! is_string($lockedRequest->artifact_path)
                    || ! hash_equals($artifactPath, $lockedRequest->artifact_path)) {
                    return false;
                }
                // The encrypted outbox row commits with this generation, so a
                // notice queued for an older file is dropped instead of
                // announcing a replaced or cancelled export.
                $now = now();
                $downloadExpiresAt = $now->copy()->addDays(self::DOWNLOAD_TTL_DAYS);
                NotificationInbox::record(
                    $userId,
                    NotificationKinds::DATA_EXPORT_READY,
                    null,
                    null,
                    'data_export_ready:'.$lockedRequest->id.':'.$mailGeneration,
                );
                if (! UvhMail::dataExportReady(
                    $lockedUser->email,
                    $url,
                    $downloadExpiresAt->format('d/m/Y H:i'),
                    (int) $lockedRequest->id,
                    $mailGeneration,
                )) {
                    throw new \RuntimeException('Ready email queue admission failed');
                }
                $lockedRequest->update([
                    'status' => 'ready',
                    'stage' => null,
                    'artifact_path' => $artifactPath,
                    'mail_generation_hash' => $mailGeneration,
                    'download_expires_at' => $downloadExpiresAt,
                    'ready_at' => $now,
                ]);

                return true;
            });
            if (! $madeReady) {
                PrivateArtifactCleanup::attempt($requestId, $artifactPath);

                return;
            }

            Audit::write($userId, 'account.data_export_ready', 'data_export', $requestId);
        } catch (\Throwable) {
            PrivateArtifactCleanup::attempt($requestId, $artifactPath);
            throw new \RuntimeException('No se pudo generar la exportación de datos');
        }
    }

    public function failed(\Throwable $exception): void
    {
        $snapshot = DataExportRequest::where('id', $this->requestId)->first(['id', 'user_id']);
        if (! $snapshot) {
            return;
        }
        $result = DB::transaction(function () use ($snapshot): ?array {
            User::where('id', $snapshot->user_id)->lockForUpdate()->first();
            $request = DataExportRequest::where('id', $snapshot->id)
                ->where('user_id', $snapshot->user_id)->lockForUpdate()->first();
            if (! $request || $request->status !== 'processing') {
                return null;
            }
            $path = is_string($request->artifact_path) && $request->artifact_path !== ''
                ? $request->artifact_path
                : null;
            // Exhausted retries are terminal: the owner sees a failed export
            // and can ask for a new one, never a silent dead state.
            $request->update([
                'status' => 'failed',
                'stage' => null,
                'mail_generation_hash' => null,
                'failure_reason' => 'generation_error',
            ]);

            return ['path' => $path, 'user_id' => (int) $request->user_id, 'request_id' => (int) $request->id];
        });
        if (! $result) {
            return;
        }
        if (is_string($result['path']) && $result['path'] !== '') {
            PrivateArtifactCleanup::attempt($result['request_id'], $result['path']);
        }
        Audit::write($result['user_id'], 'account.data_export_failed', 'data_export', $result['request_id']);
    }

    /**
     * El techo operativo se superó (o el proceso no tiene memoria de sobra):
     * la solicitud termina con el motivo que el panel traduce al camino
     * gestionado de derechos. El artefacto registrado se retira.
     */
    private function failTooLarge(int $userId, int $requestId, string $artifactPath): void
    {
        $failed = DB::transaction(function () use ($requestId, $userId, $artifactPath): bool {
            User::where('id', $userId)->lockForUpdate()->first();
            $request = DataExportRequest::where('id', $requestId)
                ->where('user_id', $userId)->lockForUpdate()->first();
            if (! $request || $request->status !== 'processing'
                || ! is_string($request->artifact_path)
                || ! hash_equals($artifactPath, $request->artifact_path)) {
                return false;
            }
            $request->update([
                'status' => 'failed',
                'stage' => null,
                'artifact_path' => null,
                'mail_generation_hash' => null,
                'failure_reason' => 'automated_size_limit',
                'updated_at' => now(),
            ]);

            return true;
        });
        if ($failed) {
            PrivateArtifactCleanup::attempt($requestId, $artifactPath);
            Audit::write($userId, 'account.data_export_failed', 'data_export', $requestId, [
                'reason' => 'automated_size_limit',
            ]);
        }
    }

    /**
     * Progreso visible en la fila. La etapa se escribe por una sesión aparte de
     * la misma base: la recogida de secciones corre dentro de la transacción
     * `REPEATABLE READ READ ONLY` del snapshot, donde no cabe ninguna
     * escritura, y la etapa no es autoridad —si esta escritura falla, la
     * generación sigue igual—.
     */
    private function writeStage(int $userId, int $requestId, string $stage): void
    {
        try {
            $config = config('database.connections.'.config('database.default'));
            if (! is_array($config)) {
                return;
            }
            DB::connectUsing('export-stage', $config);
            DB::connection('export-stage')->table('data_export_requests')
                ->where('id', $requestId)
                ->where('user_id', $userId)
                ->where('status', 'processing')
                ->update(['stage' => $stage]);
        } catch (\Throwable) {
            // Mejor-que-nada: el panel mostrará la última etapa conocida.
        }
    }

    /**
     * Refuse before PHP approaches a fatal OOM. An unlimited CLI memory setting
     * is accepted, while suffixes are parsed conservatively and malformed
     * limits fail closed.
     */
    private function hasMemoryHeadroom(int $requiredBytes): bool
    {
        $raw = trim((string) ini_get('memory_limit'));
        if ($raw === '-1') {
            return true;
        }
        if (preg_match('/^(\d+)([KMG]?)$/iD', $raw, $matches) !== 1) {
            return false;
        }
        $multiplier = match (strtoupper($matches[2])) {
            'G' => 1024 * 1024 * 1024,
            'M' => 1024 * 1024,
            'K' => 1024,
            default => 1,
        };
        $limit = (int) $matches[1] * $multiplier;

        return $limit > 0 && ($limit - memory_get_usage(true)) >= $requiredBytes;
    }
}
