<?php

namespace App\Http\Controllers\Concerns;

use App\Jobs\GenerateDataExportJob;
use App\Models\DataExportRequest;
use App\Models\User;
use App\Models\UvhSession;
use App\Support\Audit;
use App\Support\Auth\AccountReadContext;
use App\Support\MfaAttempts;
use App\Support\MfaFreshness;
use App\Support\MfaStepUp;
use App\Support\OperationalMetrics;
use App\Support\PrivateArtifact;
use App\Support\PrivateArtifactCleanup;
use App\Support\UvhRequest;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;

trait AccountExportActions
{
    public function exportStatus(Request $request): JsonResponse
    {
        $context = AccountReadContext::resolve(UvhRequest::user($request), UvhRequest::sessionId($request));
        if ($context === null) {
            return response()->json(['error' => __('messages.error_3fd9c1eb0bc788')], 401);
        }
        $user = $context->user;
        $row = DataExportRequest::where('user_id', $user->id)->latest('id')->first();

        return response()->json(['export' => $this->publicExport($row, (int) $user->security_version)]);
    }

    /**
     * Historial de exportaciones: las últimas diez, con su estado.
     *
     * Sólo lo que `publicExport` ya publica de cada una: sin rutas de artefacto
     * ni generaciones de correo. Una fila `ready` es la misma descarga de
     * siempre —sesión + step-up, reintentable hasta el acuse—, así que el
     * historial no añade ninguna vía de acceso que la exportación activa no
     * tuviera.
     */
    public function exportHistory(Request $request): JsonResponse
    {
        $context = AccountReadContext::resolve(UvhRequest::user($request), UvhRequest::sessionId($request));
        if ($context === null) {
            return response()->json(['error' => __('messages.error_3fd9c1eb0bc788')], 401);
        }
        $user = $context->user;
        $rows = DataExportRequest::where('user_id', $user->id)
            ->latest('id')->limit(10)->get();

        return response()->json([
            'exports' => $rows
                ->map(fn (DataExportRequest $row): ?array => $this->publicExport($row, (int) $user->security_version))
                ->values()->all(),
        ]);
    }

    public function requestExport(Request $request)
    {
        $password = UvhRequest::inputString($request, 'password');
        $factorCode = trim(UvhRequest::inputString($request, 'factorCode'));
        if ($password === '' || strlen($password) > 72 || strlen($factorCode) > 24) {
            return response()->json(['error' => __('messages.error_0aa9eb7787117b')], 422);
        }

        $user = UvhRequest::user($request);
        $purpose = 'data-export';
        if (MfaAttempts::tooMany($user->id, $purpose)) {
            return MfaAttempts::tooManyResponse($user->id, $purpose);
        }

        $sessionId = UvhRequest::sessionId($request);
        try {
            $result = DB::transaction(function () use ($user, $sessionId, $password, $factorCode, $purpose): array {
                $lockedUser = $this->lockVerifiedActor($user, $sessionId);
                $session = UvhSession::where('id', $sessionId)->where('user_id', $user->id)
                    ->whereNull('revoked_at')->lockForUpdate()->first();
                if (! $lockedUser || ! $lockedUser->email_verified_at || ! $session
                    || (int) $session->security_version !== (int) $lockedUser->security_version) {
                    return ['status' => 'stale'];
                }

                $active = DataExportRequest::where('user_id', $lockedUser->id)
                    ->whereIn('status', ['processing', 'ready'])
                    ->lockForUpdate()
                    ->first();
                $staleSecurity = $active && (int) $active->security_version !== (int) $lockedUser->security_version;
                if ($active && ! $staleSecurity && ! $this->isExpired($active)) {
                    return ['status' => 'active', 'export' => $active];
                }

                $stepUp = MfaStepUp::verify($lockedUser, $session, $password, $factorCode, true, $purpose);
                if ($stepUp['status'] !== 'ok') {
                    return ['status' => $stepUp['status']];
                }

                $expiredArtifact = null;
                if ($active) {
                    if (is_string($active->artifact_path) && $active->artifact_path !== '') {
                        $expiredArtifact = ['id' => (int) $active->id, 'path' => $active->artifact_path];
                    }
                    $active->update([
                        'status' => $staleSecurity ? 'cancelled' : 'expired',
                        'mail_generation_hash' => null,
                    ]);
                }

                if (isset($stepUp['recovery_codes'])) {
                    $lockedUser->update(['recovery_codes' => $stepUp['recovery_codes'], 'updated_at' => now()]);
                }

                // The step-up above is the whole authorisation: there is no
                // confirmation link to wait for, so generation starts now and
                // the panel tracks it in the background.
                $row = DataExportRequest::create([
                    'user_id' => $lockedUser->id,
                    'security_version' => (int) $lockedUser->security_version,
                    'status' => 'processing',
                ]);

                Audit::write($lockedUser->id, 'account.data_export_requested', 'data_export', $row->id, ['factor' => $stepUp['factor']]);

                return [
                    'status' => 'created',
                    'export' => $row,
                    'factor' => $stepUp['factor'],
                    'expired_artifact' => $expiredArtifact,
                ];
            });
        } catch (QueryException $e) {
            if (($e->errorInfo[0] ?? null) === '23505') {
                return response()->json(['error' => __('messages.error_8d938c79c73b86')], 409);
            }
            throw $e;
        }

        if ($result['status'] === 'stale') {
            return response()->json(['error' => __('messages.error_3fd9c1eb0bc788')], 409);
        }
        if ($result['status'] === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, $purpose);
        }
        if ($result['status'] === 'reauth') {
            return MfaFreshness::reauthenticationRequired();
        }
        if ($result['status'] === 'password') {
            Audit::write($user->id, 'account.data_export_request_failed', 'user', $user->id, ['reason' => 'password']);

            return response()->json(['error' => __('messages.error_30124a1d7f08a4')], 403);
        }
        if ($result['status'] === 'factor') {
            Audit::write($user->id, 'account.data_export_request_failed', 'user', $user->id, ['reason' => 'factor']);

            return response()->json(['error' => __('messages.error_94f7173a80a9cb')], 403);
        }
        if ($result['status'] === 'active') {
            return response()->json([
                'error' => __('messages.error_8d938c79c73b86'),
                'export' => $this->publicExport($result['export']),
            ], 409);
        }

        if (is_array($result['expired_artifact'] ?? null)) {
            PrivateArtifactCleanup::afterCommit(
                $result['expired_artifact']['id'],
                $result['expired_artifact']['path'],
            );
        }

        // Publish only after the outer commit: an external queue cannot roll
        // back a job, and a worker must be able to see the durable request.
        // The processing row remains a recovery marker if publication fails.
        $exportId = (int) $result['export']->id;
        $userId = (int) $user->id;
        DB::afterCommit(static function () use ($exportId, $userId): void {
            try {
                GenerateDataExportJob::dispatch($exportId);
            } catch (\Throwable) {
                OperationalMetrics::increment('export.queue_unavailable');
                Audit::write($userId, 'account.data_export_queue_deferred', 'data_export', $exportId);
            }
        });

        return response()->json(['export' => $this->publicExport($result['export'])], 202);
    }

    public function cancelExport(Request $request)
    {
        $user = UvhRequest::user($request);
        $sessionId = UvhRequest::sessionId($request);
        $result = DB::transaction(function () use ($user, $sessionId): array {
            if (! $this->lockVerifiedActor($user, $sessionId)) {
                return ['status' => 'stale'];
            }
            $row = DataExportRequest::where('user_id', $user->id)
                ->whereIn('status', ['processing', 'ready'])
                ->lockForUpdate()->first();
            if (! $row) {
                return ['status' => 'missing'];
            }
            $path = $row->artifact_path;
            $row->update([
                'status' => 'cancelled',
                'mail_generation_hash' => null,
            ]);

            Audit::write($user->id, 'account.data_export_cancelled', 'data_export', $row->id);

            return [
                'status' => 'cancelled',
                'id' => (int) $row->id,
                'path' => is_string($path) ? $path : null,
            ];
        });
        if ($result['status'] === 'stale') {
            return response()->json(['error' => __('messages.error_3fd9c1eb0bc788')], 409);
        }
        if ($result['status'] === 'missing') {
            return response()->json(['error' => __('messages.error_cae69e3d80953a')], 409);
        }
        if (is_string($result['path']) && $result['path'] !== '') {
            PrivateArtifactCleanup::afterCommit($result['id'], $result['path']);
        }

        return response()->json(['ok' => true]);
    }

    /**
     * La descarga se autoriza con la sesión y un step-up reciente: la
     * exportación pertenece a la cuenta y el artefacto se entrega sólo a quien
     * acaba de demostrar la contraseña y, si está activo, el segundo factor.
     * Sigue siendo de un solo uso por solicitud: el acuse posterior consume la
     * exportación.
     */
    public function downloadExport(Request $request)
    {
        $password = UvhRequest::inputString($request, 'password');
        $factorCode = trim(UvhRequest::inputString($request, 'factorCode'));
        if ($password === '' || strlen($password) > 72 || strlen($factorCode) > 24) {
            return response()->json(['error' => __('messages.error_0aa9eb7787117b')], 422);
        }

        $user = UvhRequest::user($request);
        $purpose = 'data-export';
        if (MfaAttempts::tooMany($user->id, $purpose)) {
            return MfaAttempts::tooManyResponse($user->id, $purpose);
        }

        $sessionId = UvhRequest::sessionId($request);
        try {
            $result = DB::transaction(function () use ($user, $sessionId, $password, $factorCode, $purpose): array {
                $lockedUser = $this->lockVerifiedActor($user, $sessionId);
                $session = UvhSession::where('id', $sessionId)->where('user_id', $user->id)
                    ->whereNull('revoked_at')->lockForUpdate()->first();
                if (! $lockedUser || ! $session
                    || (int) $session->security_version !== (int) $lockedUser->security_version) {
                    return ['status' => 'stale'];
                }
                $row = DataExportRequest::where('user_id', $lockedUser->id)
                    ->where('status', 'ready')->lockForUpdate()->first();
                if (! $row) {
                    return ['status' => 'missing'];
                }
                $path = is_string($row->artifact_path) ? $row->artifact_path : null;
                if ($row->download_expires_at?->isFuture() !== true) {
                    $row->update(['status' => 'expired', 'mail_generation_hash' => null]);

                    return ['status' => 'expired', 'path' => $path, 'request_id' => (int) $row->id];
                }
                if ((int) $row->security_version !== (int) $lockedUser->security_version) {
                    $row->update(['status' => 'cancelled', 'mail_generation_hash' => null]);

                    return ['status' => 'invalid', 'path' => $path, 'request_id' => (int) $row->id];
                }

                $stepUp = MfaStepUp::verify($lockedUser, $session, $password, $factorCode, true, $purpose);
                if ($stepUp['status'] !== 'ok') {
                    return ['status' => $stepUp['status']];
                }
                if (isset($stepUp['recovery_codes'])) {
                    $lockedUser->update(['recovery_codes' => $stepUp['recovery_codes'], 'updated_at' => now()]);
                }
                if (! is_string($path) || $path === '' || ! PrivateArtifactCleanup::isManagedPath($path)) {
                    $row->update(['status' => 'failed', 'failure_reason' => 'generation_error', 'mail_generation_hash' => null]);

                    return ['status' => 'missing', 'path' => $path, 'request_id' => (int) $row->id];
                }

                // Return only immutable identifiers and the managed path. Slow
                // private-volume I/O and decryption must never extend the row
                // locks protecting the user's security generation.
                return ['status' => 'ok', 'path' => $path, 'user_id' => (int) $lockedUser->id, 'request_id' => (int) $row->id];
            });
        } catch (\Throwable) {
            // Keep the request state untouched when PostgreSQL is temporarily
            // unavailable. The caller can safely retry.
            OperationalMetrics::increment('export.download_unavailable');

            return response()->json([
                'error' => __('messages.error_d06f71e68bba00'),
            ], 503);
        }

        if ($result['status'] !== 'ok'
            && isset($result['request_id'])
            && is_string($result['path'] ?? null)) {
            PrivateArtifactCleanup::afterCommit((int) $result['request_id'], $result['path']);
        }
        if ($result['status'] === 'stale') {
            return response()->json(['error' => __('messages.error_3fd9c1eb0bc788')], 409);
        }
        if ($result['status'] === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, $purpose);
        }
        if ($result['status'] === 'reauth') {
            return MfaFreshness::reauthenticationRequired();
        }
        if ($result['status'] === 'password') {
            Audit::write($user->id, 'account.data_export_download_failed', 'user', $user->id, ['reason' => 'password']);

            return response()->json(['error' => __('messages.error_30124a1d7f08a4')], 403);
        }
        if ($result['status'] === 'factor') {
            Audit::write($user->id, 'account.data_export_download_failed', 'user', $user->id, ['reason' => 'factor']);

            return response()->json(['error' => __('messages.error_94f7173a80a9cb')], 403);
        }
        if ($result['status'] === 'expired') {
            return response()->json(['error' => __('messages.error_b86c5f52e031a2')], 400);
        }
        if ($result['status'] === 'missing') {
            return response()->json(['error' => __('messages.error_5aaad1e3c0e977')], 410);
        }
        if ($result['status'] !== 'ok') {
            return response()->json(['error' => __('messages.error_19146c5e1534c2')], 409);
        }

        $cipher = null;
        try {
            $cipher = Storage::disk('local')->readStream($result['path']);
            if (! is_resource($cipher)) {
                throw new \RuntimeException('Private artifact storage returned an invalid value');
            }
            // La FORMA del artefacto se resuelve antes de los encabezados: un
            // fichero que no es artefacto de este sistema responde 503 sin
            // consumir nada. La autenticación de cada bloque ocurre al servir
            // cada bloque: un bloque corrupto a mitad de fichero trunca la
            // descarga —el navegador la reporta fallida—, y la exportación
            // sigue `ready` y reintentable, que es lo que un fallo de volumen
            // transitorio exige.
            $manifest = PrivateArtifact::validate($cipher);
        } catch (\Throwable) {
            if (is_resource($cipher)) {
                fclose($cipher);
            }
            // A transient volume failure or interrupted read does not consume
            // the export: it stays ready and the owner retries. Housekeeping
            // still owns eventual expiry/cleanup.
            OperationalMetrics::increment('export.download_unavailable');

            return response()->json([
                'error' => __('messages.error_d06f71e68bba00'),
            ], 503);
        }

        // La descarga queda ligada a la sesión que superó el step-up: sólo esa
        // sesión podrá confirmar recepción y consumir el artifact.
        $servedBy = UvhRequest::sessionId($request);
        try {
            $stillEligible = DB::transaction(function () use ($result, $servedBy): bool {
                $lockedUser = User::where('id', $result['user_id'])->lockForUpdate()->first();
                $session = UvhSession::where('id', $servedBy)->where('user_id', $result['user_id'])
                    ->whereNull('revoked_at')->where('expires_at', '>', now())->lockForUpdate()->first();
                $row = DataExportRequest::where('id', $result['request_id'])
                    ->where('user_id', $result['user_id'])
                    ->where('status', 'ready')->lockForUpdate()->first();

                $eligible = $row !== null
                    && $lockedUser !== null
                    && $session !== null
                    && ! $lockedUser->deleted_at
                    && $lockedUser->email_verified_at !== null
                    && (int) $session->security_version === (int) $lockedUser->security_version
                    && (int) $lockedUser->security_version === (int) $row->security_version
                    && $row->download_expires_at?->isFuture() === true
                    && is_string($row->artifact_path)
                    && hash_equals($result['path'], $row->artifact_path);
                if ($eligible) {
                    // This timestamp proves only that PHP finished preparing a
                    // response for this session. It enables acknowledgement but
                    // deliberately does not consume the export or claim receipt.
                    // The session id binds that acknowledgement to this session.
                    $row->update([
                        'download_served_at' => now(),
                        'download_served_session_id' => $servedBy,
                    ]);
                    Audit::write($lockedUser->id, 'account.data_export_served', 'data_export', $row->id);
                }

                return $eligible;
            });
        } catch (\Throwable) {
            fclose($cipher);
            OperationalMetrics::increment('export.download_unavailable');

            return response()->json([
                'error' => __('messages.error_d06f71e68bba00'),
            ], 503);
        }
        if (! $stillEligible) {
            fclose($cipher);

            return response()->json(['error' => __('messages.error_19146c5e1534c2')], 409);
        }

        // "Served" means that the response is about to leave PHP. It is not a
        // claim that the browser received every byte; the client acknowledges
        // that separately after postBlob has completed.

        // El cuerpo se descifra por bloques al salir: la memoria viva de una
        // descarga es la de un bloque, sea el documento del tamaño que sea.
        return response()->streamDownload(function () use ($cipher): void {
            try {
                foreach (PrivateArtifact::readChunks($cipher) as $chunk) {
                    echo $chunk;
                }
            } finally {
                fclose($cipher);
            }
        }, 'uvh-datos-'.now()->format('Y-m-d').'.json', [
            'Content-Type' => 'application/json; charset=utf-8',
            // Con el manifiesto del pie, el navegador comprueba la longitud
            // exacta del documento: una respuesta truncada por un bloque que
            // no cuadra NUNCA se descarga como completa.
            ...($manifest !== null ? ['Content-Length' => (string) $manifest['plaintextBytes']] : []),
            'Cache-Control' => 'private, no-store, no-cache, max-age=0',
            'Pragma' => 'no-cache',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function acknowledgeExportDownload(Request $request): Response
    {
        $user = UvhRequest::user($request);
        $sessionId = UvhRequest::sessionId($request);
        try {
            $result = DB::transaction(function () use ($user, $sessionId): array {
                // Preserve the global lock order: user before user-owned state.
                $lockedUser = $this->lockVerifiedActor($user, $sessionId);
                if (! $lockedUser) {
                    return ['status' => 'stale'];
                }
                $row = DataExportRequest::where('user_id', $user->id)
                    ->where('status', 'ready')->lockForUpdate()->first();
                if (! $row) {
                    return ['status' => 'invalid'];
                }

                $path = is_string($row->artifact_path) ? $row->artifact_path : null;
                if ($row->download_expires_at?->isFuture() !== true) {
                    $row->update(['status' => 'expired', 'mail_generation_hash' => null]);

                    return ['status' => 'expired', 'path' => $path, 'request_id' => (int) $row->id];
                }
                if ((int) $lockedUser->security_version !== (int) $row->security_version) {
                    $row->update(['status' => 'cancelled', 'mail_generation_hash' => null]);

                    return ['status' => 'invalid', 'path' => $path, 'request_id' => (int) $row->id];
                }
                if (! $row->download_served_at) {
                    // A caller cannot consume an export by invoking only the
                    // acknowledgement endpoint; the artifact must first have
                    // passed the complete server-side download preparation.
                    return ['status' => 'not_served'];
                }
                // La confirmación pertenece a la sesión que pasó el step-up y
                // descargó: otra sesión de la misma cuenta no puede consumir ni
                // borrar un artifact que nunca se le sirvió. Las filas servidas
                // antes de este despliegue (sin sesión registrada) se aceptan
                // durante su ventana de 48 h, para no varar descargas en curso.
                if ($row->download_served_session_id !== null
                    && ! hash_equals((string) $row->download_served_session_id, (string) $sessionId)) {
                    return ['status' => 'foreign_session'];
                }
                if (! $path || ! PrivateArtifactCleanup::isManagedPath($path)) {
                    $row->update(['status' => 'failed', 'failure_reason' => 'generation_error', 'mail_generation_hash' => null]);

                    return ['status' => 'missing', 'path' => $path, 'request_id' => (int) $row->id];
                }

                $row->update([
                    'status' => 'downloaded',
                    'downloaded_at' => now(),
                ]);
                Audit::write($lockedUser->id, 'account.data_export_downloaded', 'data_export', $row->id);

                return [
                    'status' => 'ok',
                    'path' => $path,
                    'user_id' => (int) $lockedUser->id,
                    'request_id' => (int) $row->id,
                ];
            });
        } catch (\Throwable) {
            OperationalMetrics::increment('export.download_ack_unavailable');

            return response()->json([
                'error' => __('messages.error_a83203b203187a'),
            ], 503);
        }

        if (isset($result['request_id']) && is_string($result['path'] ?? null)) {
            PrivateArtifactCleanup::afterCommit((int) $result['request_id'], $result['path']);
        }
        if ($result['status'] === 'stale') {
            return response()->json(['error' => __('messages.error_3fd9c1eb0bc788')], 409);
        }
        if ($result['status'] === 'expired') {
            return response()->json(['error' => __('messages.error_ebaa64a6bcdc61')], 400);
        }
        if ($result['status'] === 'missing') {
            return response()->json(['error' => __('messages.error_922d5ccd7030b1')], 410);
        }
        if ($result['status'] === 'not_served') {
            return response()->json(['error' => __('messages.error_eba58acea1b0bb')], 409);
        }
        if ($result['status'] === 'foreign_session') {
            return response()->json(['error' => __('messages.error_b31c66d481f2af')], 409);
        }
        if ($result['status'] !== 'ok') {
            return response()->json(['error' => __('messages.error_400c67a1fa307e')], 404);
        }

        return response()->json(['ok' => true]);
    }

    private function isExpired(DataExportRequest $request): bool
    {
        return $request->status === 'ready' && $request->download_expires_at?->isFuture() !== true;
    }

    /** @return array<string, mixed>|null */
    private function publicExport(?DataExportRequest $request, ?int $securityVersion = null): ?array
    {
        if (! $request) {
            return null;
        }
        $status = $securityVersion !== null && (int) $request->security_version !== $securityVersion
            ? 'cancelled'
            : ($this->isExpired($request) ? 'expired' : $request->status);

        return [
            'id' => (int) $request->id,
            'status' => $status,
            'failureReason' => $status === 'failed' ? $request->failure_reason : null,
            // Sólo una exportación en curso tiene etapa viva; junto a un estado
            // terminal sería una historia que ya no es cierta.
            'stage' => $status === 'processing' ? $request->stage : null,
            'downloadExpiresAt' => $request->download_expires_at?->toIso8601String(),
            'createdAt' => $request->created_at?->toIso8601String(),
            'readyAt' => $request->ready_at?->toIso8601String(),
            'downloadedAt' => $request->downloaded_at?->toIso8601String(),
        ];
    }
}
