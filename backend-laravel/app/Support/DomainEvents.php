<?php

namespace App\Support;

use App\Jobs\DispatchDomainEventsJob;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * Recording and fan-out of domain events.
 *
 * `record()` only inserts: it runs inside the caller's business transaction and
 * cannot fail the state write on behalf of an external integration. The
 * post-commit job (plus a housekeeping sweep for anything a crash dropped)
 * delivers to webhooks and the notification center.
 *
 * Delivery is **claimable** and **split per channel**. Two consumers run over
 * the same rows (the post-commit job and the minute-by-minute sweep), so a
 * delivery first claims the row with a bounded lease — `UPDATE … WHERE
 * locked_at IS NULL OR expired` — and only the claim winner sends. Each channel
 * (`webhook`, `notice`) then tracks its own completion, retries and give-up on
 * its own budget: a saturated webhook backlog can never swallow the alert a
 * domain owner needs, and a broken observer cannot stall an integration. The
 * historical `dispatched_at` keeps its retention meaning, now derived: both
 * channels done.
 *
 * The `event_uuid` created with the row is the external `event_id`: stable
 * across retries and re-deliveries, so a receiver can deduplicate exactly as
 * the API documentation tells it to.
 */
final class DomainEvents
{
    /** How long one delivery claim is respected before another consumer may take over. */
    private const CLAIM_LEASE_MINUTES = 10;

    /** Per-channel retry budget before that channel becomes history only. */
    private const MAX_CHANNEL_ATTEMPTS = 6;

    /**
     * @param  array<string, mixed>  $payload
     */
    public static function record(int $workspaceId, int $domainId, string $domain, string $event, array $payload = []): int
    {
        if (DB::transactionLevel() < 1) {
            throw new RuntimeException('Los eventos de dominio se registran dentro de la transacción de negocio');
        }

        return (int) DB::table('domain_events')->insertGetId([
            'workspace_id' => $workspaceId,
            'domain_id' => $domainId,
            'domain' => $domain,
            'event' => $event,
            'event_uuid' => (string) Str::uuid(),
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
        } catch (Throwable $e) {
            // The outbox row is already committed; the sweep will deliver it.
            report($e);
        }
    }

    /**
     * Deliver one event to webhooks and the notification center. Returns
     * whether the row needs no further work: fully dispatched, abandoned after
     * a bounded per-channel budget, or already claimed by another consumer.
     * Nothing here ever propagates to the caller.
     */
    public static function deliver(int $eventId): bool
    {
        $claimed = self::claim($eventId);
        if ($claimed !== true) {
            // false = another consumer is delivering right now; null = gone.
            return $claimed === null;
        }

        $event = DB::table('domain_events')->where('id', $eventId)->first();
        if ($event === null) {
            return true;
        }

        $payload = json_decode((string) $event->payload, true);
        $payload = is_array($payload) ? $payload : [];

        // Internal alerts first and independently: the notification centre is
        // the channel a human relies on and it must not queue behind an
        // external system.
        self::deliverNotices($event, $payload);
        self::deliverWebhooks($event, $payload);

        $finished = DB::table('domain_events')
            ->where('id', $eventId)
            ->whereNotNull('webhook_dispatched_at')
            ->whereNotNull('notice_dispatched_at')
            ->update(['dispatched_at' => now(), 'locked_at' => null]) === 1;
        if (! $finished) {
            // Release the claim early so a deferred channel retries on its own
            // schedule instead of waiting out the lease.
            DB::table('domain_events')->where('id', $eventId)->whereNull('dispatched_at')
                ->update(['locked_at' => null]);
        }

        return $finished
            || DB::table('domain_events')->where('id', $eventId)->whereNotNull('dispatched_at')->exists();
    }

    /**
     * Housekeeping sweep: retry deferred deliveries and drop old history.
     */
    public static function sweep(int $batch = 50): int
    {
        $now = now();
        $staleBefore = $now->copy()->subMinutes(self::CLAIM_LEASE_MINUTES);
        $ids = DB::table('domain_events')
            ->whereNull('dispatched_at')
            ->where(function ($query) use ($staleBefore) {
                $query->whereNull('locked_at')->orWhere('locked_at', '<=', $staleBefore);
            })
            ->where(function ($query) use ($now) {
                // A row is due when at least one pending channel is due.
                $query->where(function ($channel) use ($now) {
                    $channel->whereNull('webhook_dispatched_at')
                        ->where(function ($due) use ($now) {
                            $due->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', $now);
                        });
                })->orWhere(function ($channel) use ($now) {
                    $channel->whereNull('notice_dispatched_at')
                        ->where(function ($due) use ($now) {
                            $due->whereNull('notice_next_attempt_at')->orWhere('notice_next_attempt_at', '<=', $now);
                        });
                });
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

    /**
     * Claim the delivery of one event with a bounded lease. Two consumers may
     * race here on every event; the atomic conditional update elects exactly
     * one winner, and an expired lease recovers a crashed delivery.
     *
     * @return bool|null true = claimed, false = busy elsewhere, null = no row
     */
    private static function claim(int $eventId): ?bool
    {
        $staleBefore = now()->subMinutes(self::CLAIM_LEASE_MINUTES);
        $claimed = DB::table('domain_events')
            ->where('id', $eventId)
            ->whereNull('dispatched_at')
            ->where(function ($query) use ($staleBefore) {
                $query->whereNull('locked_at')->orWhere('locked_at', '<=', $staleBefore);
            })
            ->update(['locked_at' => now()]);
        if ($claimed === 1) {
            return true;
        }

        return DB::table('domain_events')->where('id', $eventId)->whereNull('dispatched_at')->exists()
            ? false
            : null;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private static function deliverNotices(object $event, array $payload): void
    {
        $eventId = (int) $event->id;
        if ($event->notice_dispatched_at !== null) {
            return;
        }
        if (! DomainNotices::handles((string) $event->event)) {
            DB::table('domain_events')->where('id', $eventId)->update(['notice_dispatched_at' => now()]);

            return;
        }
        if (! self::channelDue($event->notice_next_attempt_at ?? null)) {
            return;
        }
        try {
            DomainNotices::deliver($event, $payload);
            DB::table('domain_events')->where('id', $eventId)->update(['notice_dispatched_at' => now()]);
        } catch (Throwable $e) {
            // An inbox problem delays the alert, it never silences it: the
            // channel retries on its own budget and does not touch webhooks.
            report($e);
            self::deferChannel($eventId, 'notice', (int) ($event->notice_attempts ?? 0));
        }
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private static function deliverWebhooks(object $event, array $payload): void
    {
        $eventId = (int) $event->id;
        if ($event->webhook_dispatched_at !== null) {
            return;
        }
        if (! WebhookEvents::exists((string) $event->event)) {
            DB::table('domain_events')->where('id', $eventId)->update(['webhook_dispatched_at' => now()]);

            return;
        }
        if (! self::channelDue($event->next_attempt_at ?? null)) {
            return;
        }
        try {
            DB::transaction(function () use ($event, $payload): void {
                WebhookService::dispatch(
                    (int) $event->workspace_id,
                    (string) $event->event,
                    $payload,
                    self::externalId($event),
                );
            });
            DB::table('domain_events')->where('id', $eventId)->update(['webhook_dispatched_at' => now()]);
        } catch (WebhookAdmissionUnavailable $e) {
            // A saturated webhook backlog delays the integration only. The
            // notification channel has already run above and must never be
            // held hostage by an external queue.
            self::deferChannel($eventId, 'webhook', (int) ($event->attempts ?? 0));
        } catch (Throwable $e) {
            // A broken observer must not retry forever either; the domain state
            // is already committed and is the authoritative record.
            report($e);
            DB::table('domain_events')->where('id', $eventId)->update(['webhook_dispatched_at' => now()]);
        }
    }

    /**
     * External identity of the event: the stable `event_id` receivers
     * deduplicate by. Generated with the row; only a pre-migration row without
     * one is filled in here, under the delivery claim (so exactly once).
     */
    private static function externalId(object $event): string
    {
        $uuid = (string) ($event->event_uuid ?? '');
        if ($uuid !== '') {
            return $uuid;
        }
        $uuid = (string) Str::uuid();
        DB::table('domain_events')->where('id', (int) $event->id)
            ->whereNull('event_uuid')
            ->update(['event_uuid' => $uuid]);

        return $uuid;
    }

    private static function channelDue(mixed $nextAttemptAt): bool
    {
        if ($nextAttemptAt === null) {
            return true;
        }
        try {
            return Carbon::parse($nextAttemptAt)->lte(now());
        } catch (Throwable) {
            return true;
        }
    }

    private static function deferChannel(int $eventId, string $channel, int $attempts): void
    {
        // Exponential backoff capped at one hour; after the budget the channel
        // is marked done ("history only") without ever having blocked the
        // other one.
        $finish = $attempts + 1 >= self::MAX_CHANNEL_ATTEMPTS;
        $delayMinutes = min(60, 5 * (2 ** min($attempts, 4)));
        if ($channel === 'notice') {
            DB::table('domain_events')->where('id', $eventId)->update([
                'notice_attempts' => $attempts + 1,
                'notice_next_attempt_at' => $finish ? now() : now()->addMinutes($delayMinutes),
                'notice_dispatched_at' => $finish ? now() : null,
            ]);

            return;
        }
        DB::table('domain_events')->where('id', $eventId)->update([
            'attempts' => $attempts + 1,
            'next_attempt_at' => $finish ? now() : now()->addMinutes($delayMinutes),
            'webhook_dispatched_at' => $finish ? now() : null,
        ]);
    }
}
