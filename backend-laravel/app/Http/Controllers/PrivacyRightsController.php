<?php

namespace App\Http\Controllers;

use App\Support\Audit;
use App\Support\Ids;
use App\Support\MailAdmissionException;
use App\Support\OperationalMetrics;
use App\Support\UvhCrypto;
use App\Support\UvhMail;
use App\Support\UvhRequest;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

final class PrivacyRightsController
{
    private const ACTIVE = ['submitted', 'in_progress', 'waiting_user'];

    private const TYPES = ['access', 'rectification', 'erasure', 'objection', 'restriction', 'portability'];

    public function index(Request $request)
    {
        [$page, $perPage] = $this->pagination($request);
        $user = UvhRequest::user($request);
        $query = DB::table('privacy_rights_requests')->where('user_id', $user->id);
        $total = (clone $query)->count();
        $rows = $query->orderByDesc('created_at')->orderByDesc('id')
            ->offset(($page - 1) * $perPage)->limit($perPage)->get();
        $messagesByRequest = $this->publicMessagesFor($rows->pluck('id')->all());

        return response()->json([
            'requests' => $rows->map(fn ($row) => $this->publicRequest($row, true, false, $messagesByRequest)),
            'total' => $total,
            'page' => $page,
            'perPage' => $perPage,
        ]);
    }

    public function store(Request $request)
    {
        $type = UvhRequest::inputString($request, 'type');
        $details = $this->validBody(UvhRequest::inputString($request, 'details'), false);
        if (! in_array($type, self::TYPES, true) || $details === false) {
            return response()->json(['error' => 'Tipo o detalles de solicitud inválidos'], 422);
        }
        if (in_array($type, ['rectification', 'objection', 'restriction'], true) && mb_strlen($details) < 10) {
            return response()->json(['error' => 'Describe con más detalle el alcance de la solicitud'], 422);
        }

        $user = UvhRequest::user($request);
        try {
            $result = DB::transaction(function () use ($user, $type, $details): array {
                $locked = DB::table('users')->where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
                // A rights request is legally significant account state. Do not
                // accept one from a browser request that predates credential or
                // account-lifecycle rotation, even if middleware authenticated it.
                if (! $locked || $locked->email_verified_at === null
                    || (int) $locked->security_version !== (int) $user->security_version) {
                    return ['status' => 'stale'];
                }
                $active = DB::table('privacy_rights_requests')->where('user_id', $locked->id)
                    ->where('type', $type)->whereIn('status', self::ACTIVE)->lockForUpdate()->first();
                if ($active) {
                    return ['status' => 'active', 'request' => $active];
                }

                $generation = Ids::sha256Hex(Ids::randomToken(32));
                $now = now();
                $id = DB::table('privacy_rights_requests')->insertGetId([
                    'user_id' => $locked->id,
                    'security_version' => (int) $locked->security_version,
                    'type' => $type,
                    'status' => 'submitted',
                    'generation_hash' => $generation,
                    'identity_verified_at' => $now,
                    'due_at' => $now->copy()->addMonthNoOverflow(),
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
                if ($details !== '') {
                    $this->insertMessage($id, 'user', (int) $locked->id, $details);
                }
                if (! UvhMail::privacyRequestReceived((string) $locked->email, $id, $generation)) {
                    throw new MailAdmissionException('Privacy request acknowledgement outbox admission failed');
                }

                return ['status' => 'created', 'id' => $id];
            });
        } catch (QueryException $error) {
            if (($error->errorInfo[0] ?? null) === '23505') {
                return response()->json(['error' => 'Ya existe una solicitud activa de este tipo'], 409);
            }
            throw $error;
        } catch (MailAdmissionException) {
            return response()->json(['error' => 'No se pudo registrar la solicitud de forma verificable. Inténtalo de nuevo'], 503);
        }

        if ($result['status'] === 'stale') {
            return response()->json(['error' => 'La cuenta o sesión ya no está disponible'], 409);
        }
        if ($result['status'] === 'active') {
            return response()->json(['error' => 'Ya existe una solicitud activa de este tipo', 'request' => $this->publicRequest($result['request'], true)], 409);
        }

        $row = DB::table('privacy_rights_requests')->where('id', $result['id'])->first();
        Audit::write($user->id, 'privacy.request_submitted', 'privacy_right', $result['id'], ['type' => $type], UvhRequest::ip($request));

        return response()->json(['request' => $this->publicRequest($row, true)], 201);
    }

    public function respond(Request $request, int $id)
    {
        $body = $this->validBody(UvhRequest::inputString($request, 'message'), true);
        if ($body === false) {
            return response()->json(['error' => 'El mensaje debe tener entre 10 y 2.000 caracteres'], 422);
        }
        $user = UvhRequest::user($request);
        $result = DB::transaction(function () use ($user, $id, $body): string {
            $lockedUser = DB::table('users')->where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
            if (! $lockedUser || $lockedUser->email_verified_at === null
                || (int) $lockedUser->security_version !== (int) $user->security_version) {
                return 'stale';
            }
            $row = DB::table('privacy_rights_requests')->where('id', $id)->where('user_id', $user->id)
                ->lockForUpdate()->first();
            if (! $row) {
                return 'not_found';
            }
            if ($row->status !== 'waiting_user') {
                return 'state';
            }
            if (DB::table('privacy_rights_messages')->where('request_id', $id)->count() >= 20) {
                return 'limit';
            }
            $this->insertMessage($id, 'user', (int) $user->id, $body);
            DB::table('privacy_rights_requests')->where('id', $id)->update([
                'status' => 'in_progress',
                'generation_hash' => Ids::sha256Hex(Ids::randomToken(32)),
                'updated_at' => now(),
            ]);

            return 'ok';
        });

        if ($result === 'not_found') {
            return response()->json(['error' => 'Solicitud no encontrada'], 404);
        }
        if ($result === 'stale') {
            return response()->json(['error' => 'La cuenta o sesión ya no está disponible'], 409);
        }
        if ($result === 'state') {
            return response()->json(['error' => 'La solicitud no está esperando información'], 409);
        }
        if ($result === 'limit') {
            return response()->json(['error' => 'El expediente alcanzó su límite de mensajes. Contacta con soporte'], 409);
        }

        Audit::write($user->id, 'privacy.user_responded', 'privacy_right', $id, null, UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function cancel(Request $request, int $id)
    {
        $user = UvhRequest::user($request);
        try {
            $result = DB::transaction(function () use ($user, $id): string {
                $lockedUser = DB::table('users')->where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
                if (! $lockedUser || $lockedUser->email_verified_at === null
                    || (int) $lockedUser->security_version !== (int) $user->security_version) {
                    return 'stale';
                }
                $row = DB::table('privacy_rights_requests')->where('id', $id)->where('user_id', $user->id)
                    ->lockForUpdate()->first();
                if (! $row) {
                    return 'not_found';
                }
                if (! in_array($row->status, self::ACTIVE, true)) {
                    return 'state';
                }
                $generation = Ids::sha256Hex(Ids::randomToken(32));
                DB::table('privacy_rights_requests')->where('id', $id)->update([
                    'status' => 'cancelled',
                    'generation_hash' => $generation,
                    'cancelled_at' => now(),
                    'updated_at' => now(),
                ]);
                if (! UvhMail::privacyRequestUpdated((string) $lockedUser->email, $id, 'cancelled', $generation)) {
                    throw new MailAdmissionException('Privacy cancellation outbox admission failed');
                }

                return 'ok';
            });
        } catch (MailAdmissionException) {
            return response()->json(['error' => 'No se pudo registrar la cancelación de forma verificable'], 503);
        }
        if ($result === 'not_found') {
            return response()->json(['error' => 'Solicitud no encontrada'], 404);
        }
        if ($result === 'stale') {
            return response()->json(['error' => 'La cuenta o sesión ya no está disponible'], 409);
        }
        if ($result === 'state') {
            return response()->json(['error' => 'La solicitud ya no se puede cancelar'], 409);
        }

        Audit::write($user->id, 'privacy.request_cancelled', 'privacy_right', $id, null, UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function adminIndex(Request $request)
    {
        [$page, $perPage] = $this->pagination($request);
        $status = UvhRequest::queryString($request, 'status');
        $type = UvhRequest::queryString($request, 'type');
        if ($status !== '' && ! in_array($status, [...self::ACTIVE, 'completed', 'rejected', 'cancelled'], true)) {
            return response()->json(['error' => 'Estado inválido'], 422);
        }
        if ($type !== '' && ! in_array($type, self::TYPES, true)) {
            return response()->json(['error' => 'Tipo inválido'], 422);
        }
        $query = DB::table('privacy_rights_requests as r')
            ->leftJoin('users as u', 'u.id', '=', 'r.user_id')
            ->leftJoin('users as a', 'a.id', '=', 'r.assigned_admin_id')
            ->when($status !== '', fn ($q) => $q->where('r.status', $status))
            ->when($type !== '', fn ($q) => $q->where('r.type', $type));
        $total = (clone $query)->count();
        // Active work always precedes history. Within that group, expired
        // deadlines come first and the next deadline wins; terminal cases use
        // recency so old completed records cannot hide actionable requests.
        $rows = $query
            ->orderByRaw("CASE WHEN r.status IN ('submitted','in_progress','waiting_user') THEN 0 ELSE 1 END")
            ->orderByRaw("CASE WHEN COALESCE(r.extended_until, r.due_at) < NOW() AND r.status IN ('submitted','in_progress','waiting_user') THEN 0 ELSE 1 END")
            ->orderByRaw("CASE WHEN r.status IN ('submitted','in_progress','waiting_user') THEN COALESCE(r.extended_until, r.due_at) END ASC")
            ->orderByDesc('r.created_at')->orderBy('r.id')
            ->offset(($page - 1) * $perPage)->limit($perPage)
            ->get(['r.*', 'u.email', 'u.name', 'a.name as assigned_admin_name']);
        $messagesByRequest = $this->publicMessagesFor($rows->pluck('id')->all());

        return response()->json([
            'requests' => $rows->map(fn ($row) => $this->publicRequest($row, true, true, $messagesByRequest)),
            'total' => $total,
            'page' => $page,
            'perPage' => $perPage,
        ]);
    }

    public function adminAction(Request $request, int $id)
    {
        $action = UvhRequest::inputString($request, 'action');
        $reasonCode = UvhRequest::inputString($request, 'reasonCode');
        $rawMessage = UvhRequest::inputString($request, 'message');
        $messageRequired = in_array($action, ['request_information', 'complete', 'reject', 'extend'], true);
        $message = $this->validBody($rawMessage, $messageRequired);
        if (! in_array($action, ['start_review', 'request_information', 'complete', 'reject', 'extend'], true)
            || $message === false
            || ($action === 'extend' && ! in_array($reasonCode, ['complexity', 'request_volume'], true))) {
            return response()->json(['error' => 'Acción, motivo o respuesta inválidos'], 422);
        }

        $actor = UvhRequest::user($request);
        $sessionId = UvhRequest::sessionId($request);
        $snapshot = DB::table('privacy_rights_requests')->where('id', $id)->first(['user_id']);
        if (! $snapshot) {
            return response()->json(['error' => 'Solicitud no encontrada'], 404);
        }
        $targetUserId = $snapshot->user_id !== null ? (int) $snapshot->user_id : null;
        try {
            $result = DB::transaction(function () use ($actor, $sessionId, $id, $targetUserId, $action, $reasonCode, $message): array {
                $userIds = array_values(array_unique(array_filter([$actor->id, $targetUserId], fn ($value) => is_int($value))));
                sort($userIds, SORT_NUMERIC);
                $lockedUsers = DB::table('users')->whereIn('id', $userIds)->orderBy('id')->lockForUpdate()->get()->keyBy('id');
                $lockedActor = $lockedUsers->get($actor->id);
                // Keep the global lock hierarchy user -> session -> resource.
                // Account lifecycle and step-up flows use the same order, so an
                // administrator cannot deadlock them by editing a privacy case.
                if (! $this->eligibleLockedAdminSession($lockedActor, $sessionId)) {
                    return ['status' => 'actor_changed'];
                }
                $row = DB::table('privacy_rights_requests')->where('id', $id)->lockForUpdate()->first();
                if (! $row) {
                    return ['status' => 'not_found'];
                }
                if (($row->user_id !== null ? (int) $row->user_id : null) !== $targetUserId) {
                    return ['status' => 'state'];
                }
                if (! in_array($row->status, self::ACTIVE, true)) {
                    return ['status' => 'state'];
                }
                if (($action === 'start_review' && $row->status !== 'submitted')
                    || ($action === 'request_information' && ! in_array($row->status, ['submitted', 'in_progress'], true))) {
                    return ['status' => 'action_unavailable'];
                }
                if (DB::table('privacy_rights_messages')->where('request_id', $id)->count() >= 20 && $message !== '') {
                    return ['status' => 'limit'];
                }

                $generation = Ids::sha256Hex(Ids::randomToken(32));
                $updates = ['assigned_admin_id' => $lockedActor->id, 'generation_hash' => $generation, 'updated_at' => now()];
                $nextStatus = $row->status;
                if ($action === 'start_review') {
                    $nextStatus = 'in_progress';
                    $updates['status'] = $nextStatus;
                    $updates['acknowledged_at'] = $row->acknowledged_at ?? now();
                } elseif ($action === 'request_information') {
                    $nextStatus = 'waiting_user';
                    $updates['status'] = $nextStatus;
                    $updates['acknowledged_at'] = $row->acknowledged_at ?? now();
                } elseif ($action === 'complete') {
                    $nextStatus = 'completed';
                    $updates['status'] = $nextStatus;
                    $updates['completed_at'] = now();
                } elseif ($action === 'reject') {
                    $nextStatus = 'rejected';
                    $updates['status'] = $nextStatus;
                    $updates['completed_at'] = now();
                } else {
                    if ($row->extended_until !== null || now()->gt($row->due_at)) {
                        return ['status' => 'extension_unavailable'];
                    }
                    $updates['extended_until'] = Carbon::parse($row->due_at)->addMonthsNoOverflow(2);
                    $updates['extension_reason_code'] = $reasonCode;
                }
                DB::table('privacy_rights_requests')->where('id', $id)->update($updates);
                if ($message !== '') {
                    $this->insertMessage($id, 'admin', (int) $lockedActor->id, $message);
                }

                $target = $targetUserId !== null ? $lockedUsers->get($targetUserId) : null;
                if ($target && $target->deleted_at === null
                    && ! UvhMail::privacyRequestUpdated((string) $target->email, $id, $action === 'extend' ? 'extended' : $nextStatus, $generation)) {
                    throw new MailAdmissionException('Privacy status outbox admission failed');
                }

                return ['status' => 'ok', 'next' => $nextStatus];
            });
        } catch (MailAdmissionException) {
            return response()->json(['error' => 'No se pudo registrar y notificar la decisión de forma atómica'], 503);
        }

        if ($result['status'] === 'not_found') {
            return response()->json(['error' => 'Solicitud no encontrada'], 404);
        }
        if ($result['status'] === 'actor_changed') {
            return response()->json(['error' => 'Tu rol o MFA cambió. Vuelve a autenticarte'], 409);
        }
        if ($result['status'] === 'state') {
            return response()->json(['error' => 'La solicitud ya está cerrada'], 409);
        }
        if ($result['status'] === 'action_unavailable') {
            return response()->json(['error' => 'La acción no es válida para el estado actual'], 409);
        }
        if ($result['status'] === 'limit') {
            return response()->json(['error' => 'El expediente alcanzó su límite de mensajes'], 409);
        }
        if ($result['status'] === 'extension_unavailable') {
            return response()->json(['error' => 'La ampliación ya se usó o el plazo ordinario venció'], 409);
        }

        Audit::write($actor->id, 'admin.privacy_action', 'privacy_right', $id, ['action' => $action], UvhRequest::ip($request));

        return response()->json(['ok' => true, 'status' => $result['next']]);
    }

    private function publicRequest(object $row, bool $includeMessages, bool $admin = false, ?array $messagesByRequest = null): array
    {
        $deadline = $row->extended_until ?? $row->due_at;
        $result = [
            'id' => (int) $row->id,
            'type' => (string) $row->type,
            'status' => (string) $row->status,
            'identityVerifiedAt' => $row->identity_verified_at,
            'acknowledgedAt' => $row->acknowledged_at,
            'dueAt' => $row->due_at,
            'extendedUntil' => $row->extended_until,
            'extensionReasonCode' => $row->extension_reason_code,
            'completedAt' => $row->completed_at,
            'cancelledAt' => $row->cancelled_at,
            'createdAt' => $row->created_at,
            'updatedAt' => $row->updated_at,
            'overdue' => in_array($row->status, self::ACTIVE, true) && now()->gt($deadline),
        ];
        if ($admin) {
            $result['userId'] = $row->user_id !== null ? (int) $row->user_id : null;
            $result['name'] = $row->name ?? 'Cuenta eliminada';
            $result['email'] = $row->email ?? null;
            $result['assignedAdminName'] = $row->assigned_admin_name ?? null;
        }
        if ($includeMessages) {
            if ($messagesByRequest === null) {
                $messagesByRequest = $this->publicMessagesFor([(int) $row->id]);
            }
            $result['messages'] = $messagesByRequest[(int) $row->id] ?? [];
        }

        return $result;
    }

    /**
     * Load all messages for one response page in one bounded query. A case has
     * at most 20 messages, so the largest admin page hydrates at most 1,000.
     *
     * @param  array<int, int|string>  $requestIds
     * @return array<int, array<int, array{id:int,authorRole:string,body:?string,createdAt:mixed}>>
     */
    private function publicMessagesFor(array $requestIds): array
    {
        if ($requestIds === []) {
            return [];
        }

        $grouped = [];
        // The hard cap protects list endpoints even if legacy/manual data ever
        // violates the application-level 20-message invariant.
        $limit = max(20, min(1000, count($requestIds) * 20));
        $messages = DB::table('privacy_rights_messages')
            ->whereIn('request_id', $requestIds)
            ->orderBy('request_id')->orderBy('created_at')->orderBy('id')
            ->limit($limit)->get();
        foreach ($messages as $message) {
            $requestId = (int) $message->request_id;
            $grouped[$requestId][] = [
                'id' => (int) $message->id,
                'authorRole' => (string) $message->author_role,
                'body' => $this->decryptBody((string) $message->encrypted_body),
                'createdAt' => $message->created_at,
            ];
        }

        return $grouped;
    }

    private function insertMessage(int $requestId, string $role, ?int $authorId, string $body): void
    {
        DB::table('privacy_rights_messages')->insert([
            'request_id' => $requestId,
            'author_role' => $role,
            'author_user_id' => $authorId,
            'encrypted_body' => UvhCrypto::encryptAtRest($body),
            'created_at' => now(),
        ]);
    }

    private function decryptBody(string $encrypted): ?string
    {
        try {
            return UvhCrypto::decryptAtRest($encrypted);
        } catch (\Throwable) {
            // Corrupt ciphertext must not turn the whole case list into a 500,
            // but operations still need a PII-free signal to investigate it.
            OperationalMetrics::increment('privacy.decrypt_failed');

            return null;
        }
    }

    /** Revalidate platform authority and the exact fresh MFA session under locks. */
    private function eligibleLockedAdminSession(?object $actor, ?string $sessionId): bool
    {
        if (! $actor || $sessionId === null || $actor->deleted_at !== null
            || $actor->email_verified_at === null || ! (bool) $actor->is_admin || ! (bool) $actor->mfa_enabled) {
            return false;
        }
        $session = DB::table('sessions')->where('id', $sessionId)->where('user_id', $actor->id)
            ->whereNull('revoked_at')->lockForUpdate()->first();
        if (! $session || (int) $session->security_version !== (int) $actor->security_version
            || Carbon::parse($session->expires_at)->isPast() || $session->mfa_verified_at === null) {
            return false;
        }
        $freshMinutes = max(1, min(60, (int) config('uvh.admin_mfa_fresh_minutes', 15)));

        return Carbon::parse($session->mfa_verified_at)->gte(now()->subMinutes($freshMinutes));
    }

    private function validBody(string $body, bool $required): string|false
    {
        $body = trim($body);
        if (! mb_check_encoding($body, 'UTF-8')) {
            return false;
        }
        $length = mb_strlen($body);
        if (($required && $length < 10) || $length > 2000 || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', $body)) {
            return false;
        }

        return $body;
    }

    /** @return array{0:int,1:int} */
    private function pagination(Request $request): array
    {
        // OFFSET remains intentionally bounded until this low-volume workflow
        // migrates to cursor pagination; huge authenticated offsets waste DB CPU.
        $page = filter_var($request->query('page'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 10_000]]) ?: 1;
        $perPage = filter_var($request->query('perPage'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 50]]) ?: 20;

        return [(int) $page, (int) $perPage];
    }
}
