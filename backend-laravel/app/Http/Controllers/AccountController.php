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
use App\Support\MfaStepUp;
use App\Support\MfaInfrastructureUnavailable;
use App\Support\OperationalMetrics;
use App\Support\PrivateArtifactCleanup;
use App\Support\UvhCrypto;
use App\Support\UvhMail;
use App\Support\UvhRequest;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Storage;

class AccountController
{
    private const SENSITIVE_ATTEMPTS = 10;

    private const SENSITIVE_WINDOW = 900;

    public function exportStatus(Request $request)
    {
        $user = UvhRequest::user($request);
        $row = DataExportRequest::where('user_id', $user->id)->latest('id')->first();

        return response()->json(['export' => $this->publicExport($row, (int) $user->security_version)]);
    }

    public function requestExport(Request $request)
    {
        $password = UvhRequest::inputString($request, 'password');
        $factorCode = trim(UvhRequest::inputString($request, 'factorCode'));
        if ($password === '' || strlen($password) > 72 || strlen($factorCode) > 24) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $user = UvhRequest::user($request);
        $attemptKey = $this->attemptKey($user->id, 'data-export');
        if ($this->tooManySensitiveAttempts($attemptKey)) {
            return response()->json(['error' => 'Demasiados intentos. Espera unos minutos.'], 429);
        }

        $confirmationToken = Ids::randomToken(32);
        $url = rtrim((string) config('app.url'), '/').'/auth/confirm-export#token='.rawurlencode($confirmationToken);
        $sessionId = UvhRequest::sessionId($request);
        try {
            $result = DB::transaction(function () use ($user, $sessionId, $password, $factorCode, $confirmationToken, $url): array {
                $lockedUser = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
                $session = UvhSession::where('id', $sessionId)->where('user_id', $user->id)
                    ->whereNull('revoked_at')->lockForUpdate()->first();
                if (! $lockedUser || ! $lockedUser->email_verified_at || ! $session
                    || (int) $session->security_version !== (int) $lockedUser->security_version) {
                    return ['status' => 'stale'];
                }

                $active = DataExportRequest::where('user_id', $lockedUser->id)
                    ->whereIn('status', ['requested', 'processing', 'ready'])
                    ->lockForUpdate()
                    ->first();
                $staleSecurity = $active && (int) $active->security_version !== (int) $lockedUser->security_version;
                if ($active && ! $staleSecurity && ! $this->isExpired($active)) {
                    return ['status' => 'active', 'export' => $active];
                }

                $stepUp = MfaStepUp::verify($lockedUser, $session, $password, $factorCode);
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
                        'confirmation_token_hash' => null,
                        'download_token_hash' => null,
                    ]);
                }

                if (isset($stepUp['recovery_codes'])) {
                    $lockedUser->update(['recovery_codes' => $stepUp['recovery_codes'], 'updated_at' => now()]);
                }

                $row = DataExportRequest::create([
                    'user_id' => $lockedUser->id,
                    'security_version' => (int) $lockedUser->security_version,
                    'status' => 'requested',
                    'confirmation_token_hash' => Ids::sha256Hex($confirmationToken),
                    'confirmation_expires_at' => now()->addHour(),
                ]);
                if (! UvhMail::dataExportConfirmation(
                    $lockedUser->email,
                    $url,
                    (int) $row->id,
                    Ids::sha256Hex($confirmationToken),
                )) {
                    throw new MailAdmissionException('Data export confirmation queue admission failed');
                }

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
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['kind' => 'data_export_confirmation']);
            return response()->json(['error' => 'No se pudo enviar la confirmación. Inténtalo de nuevo más tarde'], 503);
        }

        if ($result['status'] === 'stale') {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión'], 409);
        }
        if ($result['status'] === 'password') {
            Audit::write($user->id, 'account.data_export_request_failed', 'user', $user->id, ['reason' => 'password']);
            return response()->json(['error' => 'Contraseña incorrecta'], 403);
        }
        if ($result['status'] === 'factor') {
            $this->recordSensitiveFailure($attemptKey);
            Audit::write($user->id, 'account.data_export_request_failed', 'user', $user->id, ['reason' => 'factor']);
            return response()->json(['error' => 'El código de autenticación o recuperación es incorrecto'], 403);
        }
        if ($result['status'] === 'active') {
            return response()->json([
                'error' => 'Ya existe una exportación activa para esta cuenta',
                'export' => $this->publicExport($result['export']),
            ], 409);
        }

        $this->clearSensitiveAttempts($attemptKey);
        if (is_array($result['expired_artifact'] ?? null)) {
            PrivateArtifactCleanup::attempt(
                $result['expired_artifact']['id'],
                $result['expired_artifact']['path'],
            );
        }
        Audit::write($user->id, 'account.data_export_requested', 'data_export', $result['export']->id, [
            'factor' => $result['factor'],
        ]);

        return response()->json(['export' => $this->publicExport($result['export'])], 202);
    }

    public function confirmExport(Request $request)
    {
        $token = UvhRequest::inputString($request, 'token');
        if (! preg_match('/^[A-Za-z0-9_-]{43}$/D', $token)) {
            return response()->json(['error' => 'Token inválido'], 422);
        }

        $tokenHash = Ids::sha256Hex($token);
        // This unlocked lookup is only a routing hint. The transaction locks
        // the user first and then revalidates the exact bearer row, matching
        // every authenticated lifecycle operation for the same account.
        $snapshot = DataExportRequest::where('confirmation_token_hash', $tokenHash)
            ->where('status', 'requested')->first(['id', 'user_id']);
        try {
            $result = $snapshot ? DB::transaction(function () use ($snapshot, $tokenHash): array {
                $user = User::where('id', $snapshot->user_id)->lockForUpdate()->first();
                $row = DataExportRequest::where('id', $snapshot->id)
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
                    || (int) $user->security_version !== (int) $row->security_version) {
                    $row->update(['status' => 'cancelled', 'confirmation_token_hash' => null]);
                    return ['status' => 'invalid'];
                }

                $row->update([
                    'status' => 'processing',
                    'confirmation_token_hash' => null,
                    'confirmed_at' => now(),
                ]);
                try {
                    GenerateDataExportJob::dispatch((int) $row->id)->afterCommit();
                } catch (\Throwable) {
                    throw new MailAdmissionException('Data export worker queue admission failed');
                }

                return ['status' => 'ok', 'request_id' => (int) $row->id, 'user_id' => (int) $user->id];
            }) : ['status' => 'invalid'];
        } catch (MailAdmissionException) {
            // Queue publication may fail from Laravel's after-commit callback
            // after the processing state is already durable. In that case the
            // scheduler will re-admit the idempotent job; returning a hard error
            // would tell the user the confirmation failed when it did not.
            try {
                $deferred = $snapshot && DataExportRequest::where('id', $snapshot->id)
                    ->where('status', 'processing')
                    ->whereNull('artifact_path')
                    ->exists();
            } catch (\Throwable) {
                $deferred = false;
            }
            if ($deferred) {
                OperationalMetrics::increment('export.queue_unavailable');
                Audit::write((int) $snapshot->user_id, 'account.data_export_queue_deferred', 'data_export', (int) $snapshot->id);

                return response()->json([
                    'ok' => true,
                    'queued' => false,
                    'message' => 'La exportación quedó registrada y se iniciará automáticamente cuando la cola se recupere.',
                ], 202);
            }

            return response()->json(['error' => 'No se pudo iniciar la generación. Inténtalo de nuevo más tarde'], 503);
        }

        if ($result['status'] === 'expired') {
            return response()->json(['error' => 'La confirmación ha caducado. Solicita otra exportación desde Ajustes'], 400);
        }
        if ($result['status'] !== 'ok') {
            return response()->json(['error' => 'La confirmación no es válida o ya se ha utilizado'], 400);
        }
        Audit::write($result['user_id'], 'account.data_export_confirmed', 'data_export', $result['request_id']);

        return response()->json(['ok' => true]);
    }

    public function cancelExport(Request $request)
    {
        $user = UvhRequest::user($request);
        $result = DB::transaction(function () use ($user): array {
            $row = DataExportRequest::where('user_id', $user->id)
                ->whereIn('status', ['requested', 'processing', 'ready'])
                ->lockForUpdate()->first();
            if (! $row) {
                return ['status' => 'missing'];
            }
            $path = $row->artifact_path;
            $row->update([
                'status' => 'cancelled',
                'confirmation_token_hash' => null,
                'download_token_hash' => null,
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

    public function downloadExport(Request $request)
    {
        $token = UvhRequest::inputString($request, 'token');
        if (! preg_match('/^[A-Za-z0-9_-]{43}$/D', $token)) {
            return response()->json(['error' => 'Token inválido'], 422);
        }

        $tokenHash = Ids::sha256Hex($token);
        $snapshot = DataExportRequest::where('download_token_hash', $tokenHash)
            ->where('status', 'ready')->first(['id', 'user_id']);
        try {
            $result = $snapshot ? DB::transaction(function () use ($snapshot, $tokenHash): array {
            $user = User::where('id', $snapshot->user_id)->lockForUpdate()->first();
            $row = DataExportRequest::where('id', $snapshot->id)
                ->where('user_id', $snapshot->user_id)
                ->where('download_token_hash', $tokenHash)
                ->where('status', 'ready')->lockForUpdate()->first();
            if (! $row) {
                return ['status' => 'invalid'];
            }
            if (! $row->download_expires_at || $row->download_expires_at->isPast()) {
                $path = $row->artifact_path;
                $row->update([
                    'status' => 'expired',
                    'download_token_hash' => null,
                ]);
                return ['status' => 'expired', 'path' => $path, 'request_id' => (int) $row->id];
            }
            if (! $user || $user->deleted_at
                || (int) $user->security_version !== (int) $row->security_version) {
                $path = $row->artifact_path;
                $row->update([
                    'status' => 'cancelled',
                    'download_token_hash' => null,
                ]);
                return ['status' => 'invalid', 'path' => $path, 'request_id' => (int) $row->id];
            }
            $path = $row->artifact_path;
            if (! is_string($path) || $path === '') {
                $row->update(['status' => 'failed', 'download_token_hash' => null, 'artifact_path' => null]);
                return ['status' => 'missing'];
            }
            if (! PrivateArtifactCleanup::isManagedPath($path)) {
                $row->update(['status' => 'failed', 'download_token_hash' => null]);
                return ['status' => 'missing', 'path' => $path, 'request_id' => (int) $row->id];
            }
            if (! Storage::disk('local')->exists($path)) {
                $row->update(['status' => 'failed', 'download_token_hash' => null, 'artifact_path' => null]);
                return ['status' => 'missing'];
            }
            $encrypted = Storage::disk('local')->get($path);
            if (! is_string($encrypted)) {
                $row->update(['status' => 'failed', 'download_token_hash' => null]);
                return ['status' => 'missing', 'path' => $path, 'request_id' => (int) $row->id];
            }
            try {
                $json = UvhCrypto::decryptAtRest($encrypted);
            } catch (\Throwable) {
                $row->update(['status' => 'failed', 'download_token_hash' => null]);
                return ['status' => 'missing', 'path' => $path, 'request_id' => (int) $row->id];
            }

            $row->update([
                'status' => 'downloaded',
                'download_token_hash' => null,
                'downloaded_at' => now(),
            ]);

            return ['status' => 'ok', 'json' => $json, 'path' => $path, 'user_id' => (int) $user->id, 'request_id' => (int) $row->id];
            }) : ['status' => 'invalid'];
        } catch (\Throwable) {
            // Keep the one-use bearer and request state untouched when the
            // database or private volume is temporarily unavailable. The
            // caller can safely retry instead of receiving an ambiguous 500.
            OperationalMetrics::increment('export.download_unavailable');

            return response()->json([
                'error' => 'La descarga no está disponible temporalmente. Inténtalo de nuevo.',
            ], 503);
        }

        if (isset($result['request_id']) && is_string($result['path'] ?? null)) {
            PrivateArtifactCleanup::attempt((int) $result['request_id'], $result['path']);
        }
        if ($result['status'] === 'expired') {
            return response()->json(['error' => 'El enlace de descarga ha caducado'], 400);
        }
        if ($result['status'] === 'missing') {
            return response()->json(['error' => 'El archivo ya no está disponible. Solicita una nueva exportación'], 410);
        }
        if ($result['status'] !== 'ok') {
            return response()->json(['error' => 'El enlace no es válido o ya se ha utilizado'], 400);
        }
        Audit::write($result['user_id'], 'account.data_export_downloaded', 'data_export', $result['request_id']);

        return response($result['json'], 200, [
            'Content-Type' => 'application/json; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="uvh-datos-'.now()->format('Y-m-d').'.json"',
            'Cache-Control' => 'private, no-store, no-cache, max-age=0',
            'Pragma' => 'no-cache',
            'X-Content-Type-Options' => 'nosniff',
        ]);
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
        $attemptKey = $this->attemptKey($user->id, 'account-deletion');
        if ($this->tooManySensitiveAttempts($attemptKey)) {
            return response()->json(['error' => 'Demasiados intentos. Espera unos minutos.'], 429);
        }
        $token = Ids::randomToken(32);
        $url = rtrim((string) config('app.url'), '/').'/auth/confirm-account-deletion#token='.rawurlencode($token);
        $sessionId = UvhRequest::sessionId($request);

        try {
            $result = DB::transaction(function () use ($user, $sessionId, $password, $factorCode, $token, $url): array {
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

                $stepUp = MfaStepUp::verify($lockedUser, $session, $password, $factorCode);
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
        if ($result['status'] === 'password') {
            Audit::write($user->id, 'account.deletion_request_failed', 'user', $user->id, ['reason' => 'password']);
            return response()->json(['error' => 'Contraseña incorrecta'], 403);
        }
        if ($result['status'] === 'factor') {
            $this->recordSensitiveFailure($attemptKey);
            Audit::write($user->id, 'account.deletion_request_failed', 'user', $user->id, ['reason' => 'factor']);
            return response()->json(['error' => 'El código de autenticación o recuperación es incorrecto'], 403);
        }

        $this->clearSensitiveAttempts($attemptKey);
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
                    ->whereIn('status', ['requested', 'processing', 'ready'])
                    ->whereNotNull('artifact_path')->get(['id', 'artifact_path'])
                    ->filter(fn ($export) => is_string($export->artifact_path) && $export->artifact_path !== '')
                    ->map(fn ($export) => ['id' => (int) $export->id, 'path' => $export->artifact_path])
                    ->values()->all();
                DataExportRequest::where('user_id', $user->id)
                    ->whereIn('status', ['requested', 'processing', 'ready'])
                    ->update([
                        'status' => 'cancelled',
                        'confirmation_token_hash' => null,
                        'download_token_hash' => null,
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
        ])->withCookie(\App\Support\SessionManager::clearCookie());
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

    private function attemptKey(int $userId, string $purpose): string
    {
        return 'uvh:mfa:attempts:'.$purpose.':'.$userId;
    }

    private function tooManySensitiveAttempts(string $key): bool
    {
        try {
            return RateLimiter::tooManyAttempts($key, self::SENSITIVE_ATTEMPTS);
        } catch (\Throwable $error) {
            throw new MfaInfrastructureUnavailable('Sensitive action limiter unavailable', 0, $error);
        }
    }

    private function recordSensitiveFailure(string $key): void
    {
        try {
            RateLimiter::hit($key, self::SENSITIVE_WINDOW);
        } catch (\Throwable $error) {
            throw new MfaInfrastructureUnavailable('Sensitive action limiter unavailable', 0, $error);
        }
    }

    private function clearSensitiveAttempts(string $key): void
    {
        try {
            RateLimiter::clear($key);
        } catch (\Throwable $error) {
            OperationalMetrics::increment('lock.unavailable');
            report($error);
        }
    }

    private function isExpired(DataExportRequest $request): bool
    {
        return ($request->status === 'requested' && $request->confirmation_expires_at?->isPast())
            || ($request->status === 'ready' && $request->download_expires_at?->isPast());
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
            'confirmationExpiresAt' => $request->confirmation_expires_at?->toIso8601String(),
            'downloadExpiresAt' => $request->download_expires_at?->toIso8601String(),
            'createdAt' => $request->created_at?->toIso8601String(),
            'confirmedAt' => $request->confirmed_at?->toIso8601String(),
            'readyAt' => $request->ready_at?->toIso8601String(),
            'downloadedAt' => $request->downloaded_at?->toIso8601String(),
        ];
    }
}
