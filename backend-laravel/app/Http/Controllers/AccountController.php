<?php

namespace App\Http\Controllers;

use App\Jobs\GenerateDataExportJob;
use App\Models\AccountDeletionRequest;
use App\Models\DataExportRequest;
use App\Models\EmailChangeRequest;
use App\Models\EmailToken;
use App\Models\User;
use App\Models\UvhSession;
use App\Support\AccountRecoveryLifecycle;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\LinkIntentRegistry;
use App\Support\MailAdmissionException;
use App\Support\MfaAttempts;
use App\Support\MfaFreshness;
use App\Support\MfaStepUp;
use App\Support\NotificationInbox;
use App\Support\NotificationKinds;
use App\Support\OperationalMetrics;
use App\Support\PrivateArtifact;
use App\Support\PrivateArtifactCleanup;
use App\Support\SessionManager;
use App\Support\UvhMail;
use App\Support\UvhRequest;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;

class AccountController
{
    public function exportStatus(Request $request)
    {
        $user = UvhRequest::user($request);
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
        $user = UvhRequest::user($request);
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
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $user = UvhRequest::user($request);
        $purpose = 'data-export';
        if (MfaAttempts::tooMany($user->id, $purpose)) {
            return MfaAttempts::tooManyResponse($user->id, $purpose);
        }

        $sessionId = UvhRequest::sessionId($request);
        try {
            $result = DB::transaction(function () use ($user, $sessionId, $password, $factorCode, $purpose): array {
                $lockedUser = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
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

                return [
                    'status' => 'created',
                    'export' => $row,
                    'factor' => $stepUp['factor'],
                    'expired_artifact' => $expiredArtifact,
                ];
            });
        } catch (QueryException $e) {
            if (($e->errorInfo[0] ?? null) === '23505') {
                return response()->json(['error' => 'Ya existe una exportación activa para esta cuenta'], 409);
            }
            throw $e;
        }

        if ($result['status'] === 'stale') {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión'], 409);
        }
        if ($result['status'] === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, $purpose);
        }
        if ($result['status'] === 'reauth') {
            return MfaFreshness::reauthenticationRequired();
        }
        if ($result['status'] === 'password') {
            Audit::write($user->id, 'account.data_export_request_failed', 'user', $user->id, ['reason' => 'password']);

            return response()->json(['error' => 'Contraseña incorrecta'], 403);
        }
        if ($result['status'] === 'factor') {
            Audit::write($user->id, 'account.data_export_request_failed', 'user', $user->id, ['reason' => 'factor']);

            return response()->json(['error' => 'El código de autenticación o recuperación es incorrecto'], 403);
        }
        if ($result['status'] === 'active') {
            return response()->json([
                'error' => 'Ya existe una exportación activa para esta cuenta',
                'export' => $this->publicExport($result['export']),
            ], 409);
        }

        if (is_array($result['expired_artifact'] ?? null)) {
            PrivateArtifactCleanup::attempt(
                $result['expired_artifact']['id'],
                $result['expired_artifact']['path'],
            );
        }
        Audit::write($user->id, 'account.data_export_requested', 'data_export', $result['export']->id, [
            'factor' => $result['factor'],
        ]);

        // Queue publication can fail even though the request is durable. The
        // processing row is its own recovery marker and housekeeping re-admits
        // the idempotent job, so the request is reported as started either way.
        try {
            GenerateDataExportJob::dispatch((int) $result['export']->id);
        } catch (\Throwable) {
            OperationalMetrics::increment('export.queue_unavailable');
            Audit::write($user->id, 'account.data_export_queue_deferred', 'data_export', (int) $result['export']->id);
        }

        return response()->json(['export' => $this->publicExport($result['export'])], 202);
    }

    public function cancelExport(Request $request)
    {
        $user = UvhRequest::user($request);
        $result = DB::transaction(function () use ($user): array {
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

            return [
                'status' => 'cancelled',
                'id' => (int) $row->id,
                'path' => is_string($path) ? $path : null,
            ];
        });
        if ($result['status'] === 'missing') {
            return response()->json(['error' => 'No hay una exportación activa'], 409);
        }
        if (is_string($result['path']) && $result['path'] !== '') {
            PrivateArtifactCleanup::attempt($result['id'], $result['path']);
        }
        Audit::write($user->id, 'account.data_export_cancelled', 'data_export', null);

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
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $user = UvhRequest::user($request);
        $purpose = 'data-export';
        if (MfaAttempts::tooMany($user->id, $purpose)) {
            return MfaAttempts::tooManyResponse($user->id, $purpose);
        }

        $sessionId = UvhRequest::sessionId($request);
        try {
            $result = DB::transaction(function () use ($user, $sessionId, $password, $factorCode, $purpose): array {
                $lockedUser = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
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
                if (! $row->download_expires_at || $row->download_expires_at->isPast()) {
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
                'error' => 'La descarga no está disponible temporalmente. Inténtalo de nuevo.',
            ], 503);
        }

        if ($result['status'] !== 'ok'
            && isset($result['request_id'])
            && is_string($result['path'] ?? null)) {
            PrivateArtifactCleanup::attempt((int) $result['request_id'], $result['path']);
        }
        if ($result['status'] === 'stale') {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión'], 409);
        }
        if ($result['status'] === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, $purpose);
        }
        if ($result['status'] === 'reauth') {
            return MfaFreshness::reauthenticationRequired();
        }
        if ($result['status'] === 'password') {
            Audit::write($user->id, 'account.data_export_download_failed', 'user', $user->id, ['reason' => 'password']);

            return response()->json(['error' => 'Contraseña incorrecta'], 403);
        }
        if ($result['status'] === 'factor') {
            Audit::write($user->id, 'account.data_export_download_failed', 'user', $user->id, ['reason' => 'factor']);

            return response()->json(['error' => 'El código de autenticación o recuperación es incorrecto'], 403);
        }
        if ($result['status'] === 'expired') {
            return response()->json(['error' => 'La exportación ha caducado. Solicita una nueva desde Ajustes'], 400);
        }
        if ($result['status'] === 'missing') {
            return response()->json(['error' => 'El archivo ya no está disponible. Solicita una nueva exportación'], 410);
        }
        if ($result['status'] !== 'ok') {
            return response()->json(['error' => 'La exportación cambió de estado antes de poder entregarse'], 409);
        }

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
            PrivateArtifact::validate($cipher);
        } catch (\Throwable) {
            // A transient volume failure or interrupted read does not consume
            // the export: it stays ready and the owner retries. Housekeeping
            // still owns eventual expiry/cleanup.
            OperationalMetrics::increment('export.download_unavailable');

            return response()->json([
                'error' => 'La descarga no está disponible temporalmente. Inténtalo de nuevo.',
            ], 503);
        }

        // La descarga queda ligada a la sesión que superó el step-up: sólo esa
        // sesión podrá confirmar recepción y consumir el artifact.
        $servedBy = UvhRequest::sessionId($request);
        try {
            $stillEligible = DB::transaction(function () use ($result, $servedBy): bool {
                $lockedUser = User::where('id', $result['user_id'])->lockForUpdate()->first();
                $row = DataExportRequest::where('id', $result['request_id'])
                    ->where('user_id', $result['user_id'])
                    ->where('status', 'ready')->lockForUpdate()->first();

                $eligible = $row !== null
                    && $lockedUser !== null
                    && ! $lockedUser->deleted_at
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
                }

                return $eligible;
            });
        } catch (\Throwable) {
            OperationalMetrics::increment('export.download_unavailable');

            return response()->json([
                'error' => 'La descarga no está disponible temporalmente. Inténtalo de nuevo.',
            ], 503);
        }
        if (! $stillEligible) {
            return response()->json(['error' => 'La exportación cambió de estado antes de poder entregarse'], 409);
        }

        // "Served" means that the response is about to leave PHP. It is not a
        // claim that the browser received every byte; the client acknowledges
        // that separately after postBlob has completed.
        Audit::write($result['user_id'], 'account.data_export_served', 'data_export', $result['request_id']);

        // El cuerpo se descifra por bloques al salir: la memoria viva de una
        // descarga es la de un bloque, sea el documento del tamaño que sea.
        return response()->streamDownload(function () use ($cipher): void {
            foreach (PrivateArtifact::readChunks($cipher) as $chunk) {
                echo $chunk;
            }
            if (is_resource($cipher)) {
                fclose($cipher);
            }
        }, 'uvh-datos-'.now()->format('Y-m-d').'.json', [
            'Content-Type' => 'application/json; charset=utf-8',
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
                $lockedUser = User::where('id', $user->id)->lockForUpdate()->first();
                $row = DataExportRequest::where('user_id', $user->id)
                    ->where('status', 'ready')->lockForUpdate()->first();
                if (! $row) {
                    return ['status' => 'invalid'];
                }

                $path = is_string($row->artifact_path) ? $row->artifact_path : null;
                if (! $row->download_expires_at || $row->download_expires_at->isPast()) {
                    $row->update(['status' => 'expired', 'mail_generation_hash' => null]);

                    return ['status' => 'expired', 'path' => $path, 'request_id' => (int) $row->id];
                }
                if (! $lockedUser || $lockedUser->deleted_at
                    || (int) $lockedUser->security_version !== (int) $row->security_version) {
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
                'error' => 'No se pudo confirmar la recepción. La exportación caducará automáticamente.',
            ], 503);
        }

        if (isset($result['request_id']) && is_string($result['path'] ?? null)) {
            PrivateArtifactCleanup::attempt((int) $result['request_id'], $result['path']);
        }
        if ($result['status'] === 'expired') {
            return response()->json(['error' => 'La exportación ha caducado'], 400);
        }
        if ($result['status'] === 'missing') {
            return response()->json(['error' => 'El archivo ya no está disponible'], 410);
        }
        if ($result['status'] === 'not_served') {
            return response()->json(['error' => 'La exportación todavía no se ha servido'], 409);
        }
        if ($result['status'] === 'foreign_session') {
            return response()->json(['error' => 'Confirma la descarga desde la sesión que la realizó'], 409);
        }
        if ($result['status'] !== 'ok') {
            return response()->json(['error' => 'No hay ninguna exportación disponible para esta cuenta'], 404);
        }

        Audit::write($result['user_id'], 'account.data_export_downloaded', 'data_export', $result['request_id']);

        return response()->json(['ok' => true]);
    }

    public function deletionImpact(Request $request)
    {
        $user = UvhRequest::user($request);
        $owned = DB::table('workspaces')->where('owner_user_id', $user->id)
            ->orderBy('id')->limit(20)->get(['id', 'name', 'slug']);
        $pending = AccountDeletionRequest::where('user_id', $user->id)->first();
        $blockingPrivacy = DB::table('privacy_rights_requests')->where('user_id', $user->id)
            ->whereIn('status', ['submitted', 'in_progress', 'waiting_user'])
            ->where('type', '!=', 'erasure')->orderBy('id')->get(['id', 'type', 'status', 'due_at']);

        return response()->json([
            'canDelete' => ! $user->is_admin && $owned->isEmpty() && $blockingPrivacy->isEmpty(),
            'isPlatformAdmin' => (bool) $user->is_admin,
            'ownedWorkspaces' => $owned,
            'blockingPrivacyRequests' => $blockingPrivacy,
            'request' => $pending && $pending->status === 'requested'
                && (int) $pending->security_version === (int) $user->security_version
                && $pending->confirmation_expires_at?->isFuture()
                ? [
                    'status' => 'requested',
                    'confirmationExpiresAt' => $pending->confirmation_expires_at->toIso8601String(),
                ]
                : null,
        ]);
    }

    public function requestDeletion(Request $request)
    {
        $password = UvhRequest::inputString($request, 'password');
        $factorCode = trim(UvhRequest::inputString($request, 'factorCode'));
        $confirmation = trim(UvhRequest::inputString($request, 'confirmation'));
        if ($password === '' || strlen($password) > 72 || strlen($factorCode) > 24
            || ! hash_equals('ELIMINAR MI CUENTA', $confirmation)) {
            return response()->json(['error' => 'Confirma la operación escribiendo ELIMINAR MI CUENTA'], 422);
        }

        $user = UvhRequest::user($request);
        $purpose = 'account-deletion';
        if (MfaAttempts::tooMany($user->id, $purpose)) {
            return MfaAttempts::tooManyResponse($user->id, $purpose);
        }
        $token = Ids::randomToken(32);
        $url = rtrim((string) config('app.url'), '/').'/auth/confirm-account-deletion#token='.rawurlencode($token);
        $sessionId = UvhRequest::sessionId($request);

        try {
            $result = DB::transaction(function () use ($user, $sessionId, $password, $factorCode, $purpose, $token, $url): array {
                $lockedUser = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
                $session = UvhSession::where('id', $sessionId)->where('user_id', $user->id)
                    ->whereNull('revoked_at')->lockForUpdate()->first();
                if (! $lockedUser || ! $session || ! $lockedUser->email_verified_at
                    || (int) $session->security_version !== (int) $lockedUser->security_version) {
                    return ['status' => 'stale'];
                }
                if ($lockedUser->is_admin) {
                    return ['status' => 'admin'];
                }
                $owned = DB::table('workspaces')->where('owner_user_id', $lockedUser->id)
                    ->orderBy('id')->limit(20)->get(['id', 'name', 'slug']);
                if ($owned->isNotEmpty()) {
                    return ['status' => 'owned', 'workspaces' => $owned];
                }
                $blockingPrivacy = DB::table('privacy_rights_requests')->where('user_id', $lockedUser->id)
                    ->whereIn('status', ['submitted', 'in_progress', 'waiting_user'])
                    ->where('type', '!=', 'erasure')->lockForUpdate()->get(['id', 'type']);
                if ($blockingPrivacy->isNotEmpty()) {
                    return ['status' => 'privacy', 'requests' => $blockingPrivacy];
                }

                $existing = AccountDeletionRequest::where('user_id', $lockedUser->id)->lockForUpdate()->first();
                if ($existing && $existing->status === 'requested'
                    && (int) $existing->security_version !== (int) $lockedUser->security_version) {
                    $existing->update(['status' => 'cancelled', 'confirmation_token_hash' => null]);
                }
                if ($existing && $existing->status === 'requested' && $existing->confirmation_expires_at?->isFuture()) {
                    return ['status' => 'active', 'expires_at' => $existing->confirmation_expires_at];
                }

                $stepUp = MfaStepUp::verify($lockedUser, $session, $password, $factorCode, true, $purpose);
                if ($stepUp['status'] !== 'ok') {
                    return ['status' => $stepUp['status']];
                }
                if (isset($stepUp['recovery_codes'])) {
                    $lockedUser->update(['recovery_codes' => $stepUp['recovery_codes'], 'updated_at' => now()]);
                }

                $expiresAt = now()->addHour();
                $values = [
                    'security_version' => (int) $lockedUser->security_version,
                    'status' => 'requested',
                    'confirmation_token_hash' => Ids::sha256Hex($token),
                    'cancel_token_hash' => null,
                    'confirmation_expires_at' => $expiresAt,
                    'execute_after' => null,
                    'confirmed_at' => null,
                    'cancelled_at' => null,
                    'executed_at' => null,
                ];
                if ($existing) {
                    $existing->update($values);
                    $row = $existing;
                } else {
                    $row = AccountDeletionRequest::create(['user_id' => $lockedUser->id, ...$values]);
                }
                if (! UvhMail::accountDeletionConfirmation(
                    $lockedUser->email,
                    $url,
                    (int) $row->id,
                    Ids::sha256Hex($token),
                )) {
                    throw new MailAdmissionException('Account deletion confirmation queue admission failed');
                }

                return ['status' => 'created', 'request_id' => (int) $row->id, 'expires_at' => $expiresAt, 'factor' => $stepUp['factor']];
            });
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['kind' => 'account_deletion_confirmation']);

            return response()->json(['error' => 'No se pudo enviar la confirmación. Inténtalo de nuevo más tarde'], 503);
        }

        if ($result['status'] === 'stale') {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión'], 409);
        }
        if ($result['status'] === 'admin') {
            return response()->json(['error' => 'Retira primero el rol de administrador de plataforma'], 409);
        }
        if ($result['status'] === 'owned') {
            return response()->json([
                'error' => 'Transfiere o elimina primero los workspaces de los que eres propietario',
                'ownedWorkspaces' => $result['workspaces'],
            ], 409);
        }
        if ($result['status'] === 'privacy') {
            return response()->json([
                'error' => 'Resuelve o cancela primero las solicitudes de privacidad que requieren conservar tus datos',
                'privacyRequests' => $result['requests'],
            ], 409);
        }
        if ($result['status'] === 'active') {
            return response()->json([
                'error' => 'Ya hay una confirmación pendiente',
                'confirmationExpiresAt' => $result['expires_at']->toIso8601String(),
            ], 409);
        }
        if ($result['status'] === 'locked') {
            return MfaAttempts::tooManyResponse($user->id, $purpose);
        }
        if ($result['status'] === 'reauth') {
            return MfaFreshness::reauthenticationRequired();
        }
        if ($result['status'] === 'password') {
            Audit::write($user->id, 'account.deletion_request_failed', 'user', $user->id, ['reason' => 'password']);

            return response()->json(['error' => 'Contraseña incorrecta'], 403);
        }
        if ($result['status'] === 'factor') {
            Audit::write($user->id, 'account.deletion_request_failed', 'user', $user->id, ['reason' => 'factor']);

            return response()->json(['error' => 'El código de autenticación o recuperación es incorrecto'], 403);
        }

        Audit::write($user->id, 'account.deletion_requested', 'account_deletion', $result['request_id'], [
            'factor' => $result['factor'], 'grace_days_after_confirmation' => 7,
        ]);

        return response()->json([
            'status' => 'requested',
            'confirmationExpiresAt' => $result['expires_at']->toIso8601String(),
        ], 202);
    }

    public function confirmDeletion(Request $request)
    {
        $token = UvhRequest::inputString($request, 'token');
        if (! preg_match('/^[A-Za-z0-9_-]{43}$/D', $token)) {
            return response()->json(['error' => 'Token inválido'], 422);
        }

        $tokenHash = Ids::sha256Hex($token);
        $snapshot = AccountDeletionRequest::where('confirmation_token_hash', $tokenHash)
            ->where('status', 'requested')->first(['id', 'user_id']);
        try {
            $result = $snapshot ? DB::transaction(function () use ($snapshot, $tokenHash): array {
                $user = User::where('id', $snapshot->user_id)->lockForUpdate()->first();
                $row = AccountDeletionRequest::where('id', $snapshot->id)
                    ->where('user_id', $snapshot->user_id)
                    ->where('confirmation_token_hash', $tokenHash)
                    ->where('status', 'requested')->lockForUpdate()->first();
                if (! $row) {
                    return ['status' => 'invalid'];
                }
                if (! $row->confirmation_expires_at || $row->confirmation_expires_at->isPast()) {
                    $row->update(['status' => 'expired', 'confirmation_token_hash' => null]);

                    return ['status' => 'expired'];
                }
                if (! $user || $user->deleted_at
                    || (int) $user->security_version !== (int) $row->security_version || $user->is_admin) {
                    $row->update(['status' => 'blocked', 'confirmation_token_hash' => null]);

                    return ['status' => 'blocked'];
                }
                if (DB::table('workspaces')->where('owner_user_id', $user->id)->exists()) {
                    $row->update(['status' => 'blocked', 'confirmation_token_hash' => null]);

                    return ['status' => 'owned'];
                }
                if (DB::table('privacy_rights_requests')->where('user_id', $user->id)
                    ->whereIn('status', ['submitted', 'in_progress', 'waiting_user'])
                    ->where('type', '!=', 'erasure')->lockForUpdate()->exists()) {
                    $row->update(['status' => 'blocked', 'confirmation_token_hash' => null]);

                    return ['status' => 'privacy'];
                }

                $now = now();
                $executeAfter = $now->copy()->addDays(7);
                $cancelToken = Ids::randomToken(32);
                $cancelUrl = rtrim((string) config('app.url'), '/').'/auth/cancel-account-deletion#token='.rawurlencode($cancelToken);
                NotificationInbox::record((int) $user->id, NotificationKinds::ACCOUNT_DELETION_SCHEDULED);
                if (! UvhMail::accountDeletionScheduled(
                    $user->email,
                    $cancelUrl,
                    $executeAfter->toIso8601String(),
                    (int) $row->id,
                    Ids::sha256Hex($cancelToken),
                )) {
                    throw new MailAdmissionException('Account deletion cancellation queue admission failed');
                }

                $nextVersion = (int) $user->security_version + 1;
                $user->update([
                    'deleted_at' => $now,
                    'security_version' => $nextVersion,
                    'mfa_pending_secret' => null,
                    'mfa_pending_expires_at' => null,
                    'updated_at' => $now,
                ]);
                $row->update([
                    'security_version' => $nextVersion,
                    'status' => 'scheduled',
                    'confirmation_token_hash' => null,
                    'cancel_token_hash' => Ids::sha256Hex($cancelToken),
                    'execute_after' => $executeAfter,
                    'confirmed_at' => $now,
                ]);
                DB::table('sessions')->where('user_id', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
                DB::table('api_tokens')->where('created_by', $user->id)->whereNull('revoked_at')->update(['revoked_at' => $now]);
                // Suspension revokes issued capabilities as well as received
                // invitations. Cancellation/compensation can restore this user,
                // but must not silently revive their pre-suspension bearers.
                // Acceptance locks the issuer first, so it cannot race this
                // transition using a previously observed active account.
                DB::table('invitations')->where('invited_by', $user->id)
                    ->where('status', 'pending')->update(['status' => 'cancelled']);
                DB::table('invitations')->whereRaw('lower(email) = ?', [strtolower($user->email)])
                    ->where('status', 'pending')->update(['status' => 'cancelled']);
                // Preserve explicit 24-hour incident links from password-change
                // notices. They are the last independent way to stop a hostile
                // deletion; every other verification/reset token is revoked.
                EmailToken::where('user_id', $user->id)->where('kind', '!=', 'security_revoke')->delete();
                EmailChangeRequest::where('user_id', $user->id)->delete();
                AccountRecoveryLifecycle::cancelActiveForUser((int) $user->id, $now);

                $artifacts = DataExportRequest::where('user_id', $user->id)
                    ->whereIn('status', ['processing', 'ready'])
                    ->whereNotNull('artifact_path')->get(['id', 'artifact_path'])
                    ->filter(fn ($export) => is_string($export->artifact_path) && $export->artifact_path !== '')
                    ->map(fn ($export) => ['id' => (int) $export->id, 'path' => $export->artifact_path])
                    ->values()->all();
                DataExportRequest::where('user_id', $user->id)
                    ->whereIn('status', ['processing', 'ready'])
                    ->update([
                        'status' => 'cancelled',
                        'mail_generation_hash' => null,
                        'updated_at' => $now,
                    ]);

                return [
                    'status' => 'ok', 'user_id' => (int) $user->id, 'request_id' => (int) $row->id,
                    'execute_after' => $executeAfter, 'artifacts' => $artifacts,
                ];
            }) : ['status' => 'invalid'];
        } catch (MailAdmissionException) {
            return response()->json(['error' => 'No se pudo programar la eliminación porque el email de cancelación no está disponible'], 503);
        }

        if ($result['status'] === 'expired') {
            return response()->json(['error' => 'La confirmación ha caducado'], 400);
        }
        if ($result['status'] === 'owned') {
            return response()->json(['error' => 'La cuenta ahora posee uno o más workspaces. Cancela la operación y resuelve su propiedad'], 409);
        }
        if ($result['status'] === 'privacy') {
            return response()->json(['error' => 'Hay solicitudes de privacidad activas que deben resolverse antes de eliminar la cuenta'], 409);
        }
        if ($result['status'] !== 'ok') {
            return response()->json(['error' => 'La confirmación no es válida o la cuenta ya no puede eliminarse'], 400);
        }
        foreach ($result['artifacts'] as $artifact) {
            PrivateArtifactCleanup::attempt($artifact['id'], $artifact['path']);
        }
        try {
            $intentRevocation = LinkIntentRegistry::revokeForUser($result['user_id']);
        } catch (\Throwable) {
            $intentRevocation = ['revoked' => 0, 'busy' => -1];
        }
        Audit::write($result['user_id'], 'account.deletion_scheduled', 'account_deletion', $result['request_id'], [
            'execute_after' => $result['execute_after']->toIso8601String(),
            'link_intents_revoked' => $intentRevocation['revoked'],
            'link_intents_busy' => $intentRevocation['busy'],
        ]);

        return response()->json([
            'ok' => true,
            'executeAfter' => $result['execute_after']->toIso8601String(),
        ])->withCookie(SessionManager::clearCookie());
    }

    public function cancelDeletion(Request $request)
    {
        $token = UvhRequest::inputString($request, 'token');
        if (! preg_match('/^[A-Za-z0-9_-]{43}$/D', $token)) {
            return response()->json(['error' => 'Token inválido'], 422);
        }

        $tokenHash = Ids::sha256Hex($token);
        $snapshot = AccountDeletionRequest::where('cancel_token_hash', $tokenHash)
            ->where('status', 'scheduled')->first(['id', 'user_id']);
        $result = $snapshot ? DB::transaction(function () use ($snapshot, $tokenHash): array {
            $user = User::where('id', $snapshot->user_id)->lockForUpdate()->first();
            $row = AccountDeletionRequest::where('id', $snapshot->id)
                ->where('user_id', $snapshot->user_id)
                ->where('cancel_token_hash', $tokenHash)
                ->where('status', 'scheduled')->lockForUpdate()->first();
            if (! $row || ! $row->execute_after || $row->execute_after->isPast()) {
                return ['status' => 'invalid'];
            }
            if (! $user || ! $user->deleted_at || (int) $user->security_version !== (int) $row->security_version) {
                return ['status' => 'invalid'];
            }
            $now = now();
            $user->update([
                'deleted_at' => null,
                'security_version' => (int) $user->security_version + 1,
                'updated_at' => $now,
            ]);
            $row->update([
                'status' => 'cancelled',
                'cancel_token_hash' => null,
                'cancelled_at' => $now,
            ]);

            // Cancellation is a protective operation: a mail failure must not
            // leave irreversible deletion scheduled. Use a savepoint so a bad
            // INSERT cannot poison PostgreSQL's outer cancellation transaction.
            // On success the envelope still commits with the restored account.
            try {
                $noticeAdmitted = DB::transaction(function () use ($user): bool {
                    NotificationInbox::record((int) $user->id, NotificationKinds::ACCOUNT_DELETION_CANCELLED);
                    if (! UvhMail::accountDeletionCancelled($user->email)) {
                        throw new MailAdmissionException('Deletion cancellation notice outbox admission failed');
                    }

                    return true;
                });
            } catch (\Throwable) {
                $noticeAdmitted = false;
            }

            return [
                'status' => 'ok', 'user_id' => (int) $user->id, 'request_id' => (int) $row->id,
                'notice_admitted' => $noticeAdmitted,
            ];
        }) : ['status' => 'invalid'];

        if ($result['status'] !== 'ok') {
            return response()->json(['error' => 'El enlace no es válido, ya se utilizó o el periodo de gracia terminó'], 400);
        }
        if (! $result['notice_admitted']) {
            Audit::write($result['user_id'], 'auth.email_delivery_failed', 'user', $result['user_id'], ['kind' => 'account_deletion_cancelled']);
        }
        Audit::write($result['user_id'], 'account.deletion_cancelled', 'account_deletion', $result['request_id']);

        return response()->json(['ok' => true]);
    }

    private function isExpired(DataExportRequest $request): bool
    {
        return $request->status === 'ready' && $request->download_expires_at?->isPast();
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
