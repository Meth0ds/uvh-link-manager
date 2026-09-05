<?php

namespace App\Support;

use App\Jobs\WebhookDeliveryJob;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class WebhookService
{
    private const MAX_PENDING_DELIVERIES_PER_WORKSPACE = 1000;
    private const CONFIG_LOCK_SECONDS = 30;
    public const EVENTS = [
        'link.created',
        'link.updated',
        'link.deleted',
        'link.threshold_reached',
        'domain.verified',
    ];

    /**
     * @param  array<string, mixed>  $data
     */
    public static function dispatch(int $workspaceId, string $event, array $data): void
    {
        if (DB::transactionLevel() < 1) {
            throw new WebhookAdmissionUnavailable('Webhook events must be admitted inside the business transaction');
        }
        $eventId = self::uuid();
        $payload = [
            'event' => $event,
            'event_id' => $eventId,
            'timestamp' => now()->toIso8601String(),
            'data' => $data,
        ];
        $deliveryIds = self::reserveWorkspaceDeliveries($workspaceId, function (int $pending) use ($workspaceId, $event, $eventId, $payload): array {
            $webhooks = Webhook::where('workspace_id', $workspaceId)->where('active', true)
                ->where(function ($query) {
                    $query->whereNull('created_by')->orWhereExists(function ($activeCreator) {
                        $activeCreator->selectRaw('1')->from('users')
                            ->whereColumn('users.id', 'webhooks.created_by')
                            ->whereNull('users.deleted_at')
                            ->whereExists(function ($authorizedMembership) {
                                $authorizedMembership->selectRaw('1')->from('memberships')
                                    ->whereColumn('memberships.workspace_id', 'webhooks.workspace_id')
                                    ->whereColumn('memberships.user_id', 'webhooks.created_by')
                                    ->whereIn('memberships.role', ['owner', 'admin', 'editor']);
                            });
                    });
                })->get();
            $ids = [];
            foreach ($webhooks as $webhook) {
                if (! in_array($event, $webhook->events ?? [], true)) {
                    continue;
                }
                if ($pending >= self::MAX_PENDING_DELIVERIES_PER_WORKSPACE) {
                    throw new WebhookAdmissionUnavailable('Workspace webhook backlog is full');
                }
                $delivery = WebhookDelivery::create([
                    'webhook_id' => $webhook->id,
                    'config_version' => $webhook->config_version,
                    'event' => $event,
                    'event_id' => $eventId,
                    'payload' => $payload,
                    'status' => 'pending',
                    'next_attempt_at' => now(),
                ]);
                $ids[] = (int) $delivery->id;
                $pending++;
            }

            return $ids;
        });
        self::dispatchReserved($deliveryIds);
    }

    /** Queue a manual ping under the same workspace-wide delivery budget. */
    public static function dispatchTest(Webhook $webhook, array $payload): bool
    {
        $deliveryIds = self::reserveWorkspaceDeliveries((int) $webhook->workspace_id, function (int $pending) use ($webhook, $payload): array {
            if ($pending >= self::MAX_PENDING_DELIVERIES_PER_WORKSPACE) {
                return [];
            }
            $current = Webhook::where('id', $webhook->id)
                ->where('workspace_id', $webhook->workspace_id)
                ->where('active', true)
                ->where(function ($query) {
                    $query->whereNull('created_by')->orWhereExists(function ($activeCreator) {
                        $activeCreator->selectRaw('1')->from('users')
                            ->whereColumn('users.id', 'webhooks.created_by')
                            ->whereNull('users.deleted_at')
                            ->whereExists(function ($authorizedMembership) {
                                $authorizedMembership->selectRaw('1')->from('memberships')
                                    ->whereColumn('memberships.workspace_id', 'webhooks.workspace_id')
                                    ->whereColumn('memberships.user_id', 'webhooks.created_by')
                                    ->whereIn('memberships.role', ['owner', 'admin', 'editor']);
                            });
                    });
                })
                ->first();
            if (! $current) {
                return [];
            }
            $delivery = WebhookDelivery::create([
                'webhook_id' => $current->id,
                'config_version' => $current->config_version,
                'event' => 'ping',
                'event_id' => (string) ($payload['event_id'] ?? self::uuid()),
                'payload' => $payload,
                'status' => 'pending',
                'next_attempt_at' => now(),
            ]);

            return [(int) $delivery->id];
        });
        self::dispatchReserved($deliveryIds);

        return $deliveryIds !== [];
    }

    /** Queue an already-pending durable delivery without changing its state. */
    public static function enqueueExisting(int $deliveryId): void
    {
        if (! WebhookDelivery::where('id', $deliveryId)->where('status', 'pending')->exists()) {
            return;
        }

        self::dispatchReserved([$deliveryId]);
    }

    /** Reserve backlog capacity before moving a terminal delivery to pending. */
    public static function canRequeue(int $workspaceId): bool
    {
        if (DB::transactionLevel() < 1) {
            throw new WebhookAdmissionUnavailable('Webhook requeue requires a database transaction');
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            try {
                self::lockWorkspaceAdmission($workspaceId);

                return self::pendingWorkspaceDeliveries($workspaceId) < self::MAX_PENDING_DELIVERIES_PER_WORKSPACE;
            } catch (WebhookAdmissionUnavailable $error) {
                throw $error;
            } catch (\Throwable $error) {
                Log::error('[webhook] requeue capacity check failed', [
                    'workspace_id' => $workspaceId,
                    'exception' => $error::class,
                ]);
                throw new WebhookAdmissionUnavailable('Webhook requeue capacity check failed');
            }
        }

        // Non-production fallback; production is forced to PostgreSQL.
        return self::pendingWorkspaceDeliveries($workspaceId) < self::MAX_PENDING_DELIVERIES_PER_WORKSPACE;
    }

    public static function attempt(int $deliveryId): void
    {
        // Hold the configuration lock across the network request. A successful
        // update/delete acquires this same lock first, so it cannot return to
        // the caller while an older configuration is still being delivered.
        $webhookId = WebhookDelivery::where('id', $deliveryId)->value('webhook_id');
        if (! is_int($webhookId) && ! ctype_digit((string) $webhookId)) {
            return;
        }
        try {
            $configLock = Cache::lock(self::configLockKey((int) $webhookId), self::CONFIG_LOCK_SECONDS);
            $acquired = $configLock->get();
        } catch (\Throwable $e) {
            OperationalMetrics::increment('lock.unavailable');
            Log::warning('[webhook] configuration lock backend unavailable', [
                'webhook_id' => (int) $webhookId,
                'exception' => $e::class,
            ]);
            return;
        }
        if (! $acquired) {
            OperationalMetrics::increment('lock.unavailable');
            return;
        }

        try {
            $work = DB::transaction(function () use ($deliveryId, $webhookId): ?array {
                // Controller mutations and manual resends use webhook then
                // delivery. Matching that order removes a deterministic
                // deadlock under concurrent resend/worker execution.
                $webhook = Webhook::where('id', $webhookId)->lockForUpdate()->first();
                $delivery = WebhookDelivery::where('id', $deliveryId)
                    ->where('webhook_id', $webhookId)->lockForUpdate()->first();
                if (! $delivery || $delivery->status !== 'pending') {
                    return null;
                }
                if (! $webhook || ! $webhook->active
                    || (int) $delivery->config_version !== (int) $webhook->config_version) {
                    $delivery->update([
                        'status' => 'failed',
                        'last_error' => 'Configuración de webhook modificada o eliminada antes de la entrega',
                        'locked_at' => null,
                    ]);
                    OperationalMetrics::increment('webhook.failed');
                    return null;
                }
                $creatorAuthorized = $webhook->created_by === null
                    || (DB::table('users')->where('id', $webhook->created_by)->whereNull('deleted_at')->exists()
                        && DB::table('memberships')->where('workspace_id', $webhook->workspace_id)
                            ->where('user_id', $webhook->created_by)
                            ->whereIn('role', ['owner', 'admin', 'editor'])->exists());
                if (! $creatorAuthorized) {
                    $webhook->update([
                        'active' => false,
                        'config_version' => (int) $webhook->config_version + 1,
                        'updated_at' => now(),
                    ]);
                    $delivery->update([
                        'status' => 'failed',
                        'last_error' => 'Webhook desactivado porque su creador ya no conserva permiso de edición',
                        'locked_at' => null,
                    ]);
                    OperationalMetrics::increment('webhook.failed');

                    return null;
                }

                $attempt = (int) $delivery->attempts + 1;
                $delivery->update([
                    'status' => 'processing',
                    'attempts' => $attempt,
                    'locked_at' => now(),
                    'next_attempt_at' => null,
                ]);

                return [
                    'attempt' => $attempt,
                    'url' => $webhook->url,
                    'secret' => $webhook->secret,
                    'payload' => $delivery->payload,
                    'config_version' => (int) $delivery->config_version,
                ];
            });
            if ($work === null) {
                return;
            }

            try {
                $secret = UvhCrypto::decryptAtRest((string) $work['secret']);
                $payloadJson = json_encode($work['payload'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                $timestamp = (int) floor(microtime(true) * 1000);
                // Bind freshness metadata to the payload. A receiver may
                // reject old timestamps before deduplicating event_id without
                // trusting a mutable, unsigned header value.
                $signature = hash_hmac('sha256', $timestamp.'.'.$payloadJson, $secret);
                // Guarda SSRF: esquema/puerto/credenciales validados, todas las IPs
                // resueltas deben ser públicas, fijadas en connect-time (cierra el
                // DNS-rebinding TOCTOU) y sin seguir redirecciones.
                $response = Ssrf::safeFetch($work['url'], [
                    'Content-Type: application/json',
                    'X-UVH-Event: '.(string) ($work['payload']['event'] ?? ''),
                    'X-UVH-Signature: t='.$timestamp.',v1='.$signature,
                    'X-UVH-Event-Id: '.(string) ($work['payload']['event_id'] ?? ''),
                ], $payloadJson);

                if ($response['ok']) {
                    $updated = WebhookDelivery::where('id', $deliveryId)->where('status', 'processing')
                        ->where('config_version', $work['config_version'])
                        ->update(['status' => 'success', 'delivered_at' => now(), 'locked_at' => null, 'last_error' => null]);
                    if ($updated === 1) {
                        OperationalMetrics::increment('webhook.success');
                    }
                } else {
                    self::scheduleRetry($deliveryId, $work['attempt'], 'HTTP '.$response['status']);
                }
            } catch (\Throwable $e) {
                self::scheduleRetry($deliveryId, $work['attempt'], self::safeDeliveryError($e));
            }
        } finally {
            try {
                $configLock->release();
            } catch (\Throwable $e) {
                // The lease is bounded by TTL. A release backend failure must
                // not turn an already-recorded delivery into a failed job.
                OperationalMetrics::increment('lock.unavailable');
                Log::warning('[webhook] configuration lock release failed', [
                    'webhook_id' => (int) $webhookId,
                    'exception' => $e::class,
                ]);
            }
        }
    }

    /**
     * Execute a configuration mutation only when no delivery is in flight.
     * Returns [lock acquired, callback result] so callers can present a
     * recoverable conflict instead of falsely claiming a saved change.
     *
     * @return array{0: bool, 1: mixed}
     */
    public static function mutateConfiguration(int $webhookId, callable $callback): array
    {
        try {
            $lock = Cache::lock(self::configLockKey($webhookId), self::CONFIG_LOCK_SECONDS);
            $acquired = $lock->get();
        } catch (\Throwable $e) {
            OperationalMetrics::increment('lock.unavailable');
            Log::warning('[webhook] configuration mutation lock unavailable', [
                'webhook_id' => $webhookId,
                'exception' => $e::class,
            ]);
            return [false, null];
        }
        if (! $acquired) {
            OperationalMetrics::increment('lock.unavailable');
            return [false, null];
        }

        try {
            return [true, $callback()];
        } finally {
            try {
                $lock->release();
            } catch (\Throwable $e) {
                // The mutation result is authoritative; a release error after
                // commit must not be reported to the client as an HTTP 500.
                OperationalMetrics::increment('lock.unavailable');
                Log::warning('[webhook] configuration mutation lock release failed', [
                    'webhook_id' => $webhookId,
                    'exception' => $e::class,
                ]);
            }
        }
    }

    /**
     * Deactivate an expelled member's hooks without racing an in-flight send.
     * If a configuration lock is busy the caller must leave membership intact
     * and ask for a retry. The surrounding savepoint rolls every earlier
     * deactivation back so a rejected operation has no partial side effects.
     */
    public static function deactivateOwnedBy(int $workspaceId, int $creatorId): bool
    {
        try {
            return DB::transaction(function () use ($workspaceId, $creatorId): bool {
                $ids = Webhook::where('workspace_id', $workspaceId)
                    ->where('created_by', $creatorId)
                    ->where('active', true)
                    ->orderBy('id')
                    ->pluck('id');
                foreach ($ids as $id) {
                    [$locked, $updated] = self::mutateConfiguration((int) $id, function () use ($id, $workspaceId, $creatorId): bool {
                        return DB::transaction(function () use ($id, $workspaceId, $creatorId): bool {
                            $webhook = Webhook::where('id', $id)
                                ->where('workspace_id', $workspaceId)
                                ->where('created_by', $creatorId)
                                ->where('active', true)
                                ->lockForUpdate()
                                ->first();
                            if (! $webhook) {
                                return true;
                            }
                            $webhook->update([
                                'active' => false,
                                'config_version' => (int) $webhook->config_version + 1,
                                'updated_at' => now(),
                            ]);

                            return true;
                        });
                    });
                    if (! $locked || ! $updated) {
                        throw new WebhookMutationBusy('A webhook configuration is being delivered');
                    }
                }

                return true;
            });
        } catch (WebhookMutationBusy) {
            return false;
        }
    }

    /**
     * Deactivate every active hook before deleting a workspace. This provides
     * the same no-old-configuration guarantee as an individual configuration
     * change, including for a delivery that has already reached a worker.
     */
    public static function deactivateWorkspace(int $workspaceId): bool
    {
        try {
            return DB::transaction(function () use ($workspaceId): bool {
                $ids = Webhook::where('workspace_id', $workspaceId)
                    ->where('active', true)
                    ->orderBy('id')
                    ->pluck('id');
                foreach ($ids as $id) {
                    [$locked, $updated] = self::mutateConfiguration((int) $id, function () use ($id, $workspaceId): bool {
                        return DB::transaction(function () use ($id, $workspaceId): bool {
                            $webhook = Webhook::where('id', $id)
                                ->where('workspace_id', $workspaceId)
                                ->where('active', true)
                                ->lockForUpdate()
                                ->first();
                            if (! $webhook) {
                                return true;
                            }
                            $webhook->update([
                                'active' => false,
                                'config_version' => (int) $webhook->config_version + 1,
                                'updated_at' => now(),
                            ]);

                            return true;
                        });
                    });
                    if (! $locked || ! $updated) {
                        throw new WebhookMutationBusy('A webhook configuration is being delivered');
                    }
                }

                return true;
            });
        } catch (WebhookMutationBusy) {
            return false;
        }
    }

    private static function scheduleRetry(int $deliveryId, int $attempt, string $error): void
    {
        $error = mb_substr($error, 0, 500);
        if ($attempt >= 5) {
            $updated = WebhookDelivery::where('id', $deliveryId)->where('status', 'processing')->update([
                'status' => 'failed',
                'last_error' => $error,
                'locked_at' => null,
            ]);
            if ($updated === 1) {
                OperationalMetrics::increment('webhook.failed');
            }

            return;
        }
        $delay = min(60_000, (2 ** ($attempt - 1)) * 1_000); // exponential backoff
        $updated = WebhookDelivery::where('id', $deliveryId)->where('status', 'processing')->update([
            'status' => 'pending',
            'last_error' => $error,
            'next_attempt_at' => now()->addMilliseconds($delay),
            'locked_at' => null,
        ]);
        if ($updated === 1) {
            OperationalMetrics::increment('webhook.retry_scheduled');
        }
    }

    /** Never persist curl/TLS internals, IPs or encrypted-secret errors. */
    private static function safeDeliveryError(\Throwable $error): string
    {
        $message = $error->getMessage();
        if (str_contains($message, 'destino interno bloqueado') || str_contains($message, 'puerto no permitido')) {
            return 'Destino bloqueado por la política de red';
        }
        if (str_contains($message, 'no se pudo resolver') || str_contains($message, 'host vacío')) {
            return 'No se pudo resolver el destino';
        }
        if ($error instanceof \JsonException) {
            return 'No se pudo serializar el evento';
        }

        return 'No se pudo conectar con el destino';
    }

    private static function uuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);

        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }

    private static function configLockKey(int $webhookId): string
    {
        return 'uvh:webhook-config:'.$webhookId;
    }

    /**
     * Serialize admission to the workspace backlog across requests/workers.
     * A normal business event fails its surrounding mutation if a subscribed
     * delivery cannot be preserved; a manual ping may return an empty list to
     * produce the explicit capacity response in its controller.
     *
     * @param callable(int): array<int, int> $reserve
     * @return array<int, int>
     */
    private static function reserveWorkspaceDeliveries(int $workspaceId, callable $reserve): array
    {
        if (DB::transactionLevel() < 1) {
            throw new WebhookAdmissionUnavailable('Webhook admission requires a database transaction');
        }

        // PostgreSQL transaction-scoped advisory locks remain held until the
        // caller's business transaction commits. This makes backlog counting,
        // delivery inserts and the resource mutation one atomic operation.
        if (DB::connection()->getDriverName() === 'pgsql') {
            try {
                self::lockWorkspaceAdmission($workspaceId);
                $pending = self::pendingWorkspaceDeliveries($workspaceId);

                return $reserve($pending);
            } catch (WebhookAdmissionUnavailable $error) {
                throw $error;
            } catch (\Throwable $error) {
                Log::error('[webhook] transactional delivery admission failed', [
                    'workspace_id' => $workspaceId,
                    'exception' => $error::class,
                ]);
                throw new WebhookAdmissionUnavailable('Webhook delivery admission failed');
            }
        }

        // Local/test stores retain the existing shared lock fallback. The
        // production gate requires PostgreSQL, where the transaction lock
        // above provides the commit-level guarantee.
        try {
            $lock = Cache::lock('uvh:webhook-backlog:'.$workspaceId, 5);
            if (! $lock->get()) {
                OperationalMetrics::increment('lock.unavailable');
                Log::warning('[webhook] backlog lock unavailable', ['workspace_id' => $workspaceId]);

                throw new WebhookAdmissionUnavailable('Webhook backlog lock unavailable');
            }
            try {
                $pending = DB::table('webhook_deliveries as d')
                    ->join('webhooks as w', 'w.id', '=', 'd.webhook_id')
                    ->where('w.workspace_id', $workspaceId)
                    ->whereIn('d.status', ['pending', 'processing'])
                    ->count();

                return $reserve($pending);
            } finally {
                $lock->release();
            }
        } catch (\Throwable $e) {
            Log::error('[webhook] delivery admission failed', [
                'workspace_id' => $workspaceId,
                'exception' => $e::class,
            ]);

            throw $e instanceof WebhookAdmissionUnavailable
                ? $e
                : new WebhookAdmissionUnavailable('Webhook delivery admission failed');
        }
    }

    private static function lockWorkspaceAdmission(int $workspaceId): void
    {
        $lockId = hexdec(substr(hash('sha256', 'uvh:webhook-backlog:'.$workspaceId), 0, 15));
        DB::select('SELECT pg_advisory_xact_lock(?)', [$lockId]);
    }

    private static function pendingWorkspaceDeliveries(int $workspaceId): int
    {
        return DB::table('webhook_deliveries as d')
            ->join('webhooks as w', 'w.id', '=', 'd.webhook_id')
            ->where('w.workspace_id', $workspaceId)
            ->whereIn('d.status', ['pending', 'processing'])
            ->count();
    }

    /** @param array<int, int> $deliveryIds */
    private static function dispatchReserved(array $deliveryIds): void
    {
        foreach ($deliveryIds as $id) {
            if (DB::transactionLevel() < 1) {
                self::publishDelivery($id);
                continue;
            }
            try {
                // Register an explicit guarded callback. Merely setting a
                // job's afterCommit flag does not place exceptions raised by
                // the eventual queue publication inside this try/catch.
                DB::afterCommit(static function () use ($id): void {
                    self::publishDelivery($id);
                });
            } catch (\Throwable $e) {
                Log::error('[webhook] after-commit scheduling failed; delivery remains pending', [
                    'delivery_id' => $id,
                    'exception' => $e::class,
                ]);
            }
        }
    }

    private static function publishDelivery(int $id): void
    {
        try {
            WebhookDeliveryJob::dispatch($id);
        } catch (\Throwable $error) {
            Log::error('[webhook] queue dispatch failed; delivery remains pending', [
                'delivery_id' => $id,
                'exception' => $error::class,
            ]);
        }
    }
}
