<?php

namespace App\Support;

use App\Jobs\DispatchDomainEventsJob;
use Illuminate\Support\Facades\DB;

/**
 * Recording and fan-out of domain events.
 *
 * `record()` only inserts: it runs inside the caller's business transaction and
 * cannot fail the state write on behalf of an external integration. The
 * post-commit job (plus a housekeeping sweep for anything a crash dropped)
 * delivers to webhooks and the notification center.
 */
final class DomainEvents
{
    /** Events an external integration may subscribe to. */
    public const WEBHOOK_EVENTS = [
        'domain.claimed',
        'domain.claim_transferred',
        'domain.verified',
        'domain.degraded',
        'domain.offline',
        'domain.recovered',
        'domain.activated',
        'domain.disabled',
        'domain.tls_failed',
        'domain.tls_expiring',
        'domain.deleted',
    ];

    /**
     * @param  array<string, mixed>  $payload
     */
    public static function record(int $workspaceId, int $domainId, string $domain, string $event, array $payload = []): int
    {
        if (DB::transactionLevel() < 1) {
            throw new \RuntimeException('Los eventos de dominio se registran dentro de la transacción de negocio');
        }

        return (int) DB::table('domain_events')->insertGetId([
            'workspace_id' => $workspaceId,
            'domain_id' => $domainId,
            'domain' => $domain,
            'event' => $event,
            'payload' => json_encode($payload, JSON_THROW_ON_ERROR),
            'created_at' => now(),
            'next_attempt_at' => now(),
        ]);
    }

    /**
     * Queue fan-out for the events just recorded. Safe to call after commit
     * only; a lost job is recovered by `sweep()`.
     *
     * @param  list<int>  $eventIds
     */
    public static function scheduleDispatch(array $eventIds): void
    {
        if ($eventIds === []) {
            return;
        }
        try {
            DispatchDomainEventsJob::dispatch($eventIds)->afterCommit();
        } catch (\Throwable $e) {
            // The outbox row is already committed; the sweep will deliver it.
            report($e);
        }
    }

    /**
     * Deliver one event to webhooks and the notification center. Returns
     * whether it is fully dispatched; an admission failure leaves the row for
     * a bounded retry and never propagates.
     */
    public static function deliver(int $eventId): bool
    {
        $event = DB::table('domain_events')->where('id', $eventId)->first();
        if (! $event || $event->dispatched_at !== null) {
            return true;
        }

        $payload = json_decode((string) $event->payload, true);
        $payload = is_array($payload) ? $payload : [];

        try {
            if (in_array((string) $event->event, self::WEBHOOK_EVENTS, true)) {
                DB::transaction(function () use ($event, $payload): void {
                    WebhookService::dispatch((int) $event->workspace_id, (string) $event->event, $payload);
                });
            }
            DomainNotices::deliver($event, $payload);
        } catch (WebhookAdmissionUnavailable $e) {
            self::defer((int) $event->id, (int) $event->attempts);

            return false;
        } catch (\Throwable $e) {
            // A broken observer must not retry forever either; the domain state
            // is already committed and is the authoritative record.
            report($e);
        }

        DB::table('domain_events')->where('id', $event->id)->update(['dispatched_at' => now()]);

        return true;
    }

    /**
     * Housekeeping sweep: retry deferred deliveries and drop old history.
     */
    public static function sweep(int $batch = 50): int
    {
        $ids = DB::table('domain_events')
            ->whereNull('dispatched_at')
            ->where(function ($query) {
                $query->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', now());
            })
            ->orderBy('id')
            ->limit($batch)
            ->pluck('id');
        $delivered = 0;
        foreach ($ids as $id) {
            if (self::deliver((int) $id)) {
                $delivered++;
            }
        }

        $retentionDays = max(7, (int) config('uvh.custom_domains.event_retention_days', 90));
        DB::table('domain_events')
            ->where('created_at', '<', now()->subDays($retentionDays))
            ->whereNotNull('dispatched_at')
            ->delete();

        return $delivered;
    }

    private static function defer(int $eventId, int $attempts): void
    {
        // Exponential backoff capped at one hour; six attempts ≈ a workday of
        // tolerance for a saturated backlog before the event becomes history
        // only.
        $delayMinutes = min(60, 5 * (2 ** min($attempts, 4)));
        DB::table('domain_events')->where('id', $eventId)->update([
            'attempts' => $attempts + 1,
            'next_attempt_at' => now()->addMinutes($delayMinutes),
            'dispatched_at' => $attempts + 1 >= 6 ? now() : null,
        ]);
    }
}
