<?php

namespace App\Http\Controllers;

use App\Support\DestinationDenylist;
use App\Support\OperationalMetrics;
use App\Support\QueueBacklog;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

final class OperationsController
{
    /** Prometheus text endpoint reachable only through the private listener. */
    public function metrics(Request $request): Response
    {
        $configured = trim((string) config('uvh.metrics.bearer_token'));
        $provided = trim((string) $request->bearerToken());
        if ($configured === '' || $provided === '' || ! hash_equals($configured, $provided)) {
            return response('', 404)->header('Cache-Control', 'no-store');
        }

        $lines = [
            '# HELP uvh_up Application process is responding.',
            '# TYPE uvh_up gauge',
            'uvh_up 1',
        ];
        foreach (OperationalMetrics::totals(60) as $metric => $total) {
            $name = 'uvh_event_'.str_replace('.', '_', $metric).'_60m_total';
            $lines[] = '# TYPE '.$name.' gauge';
            $lines[] = $name.' '.$total;
        }

        // Depth and age come from the configured broker: the database driver
        // answers from the `jobs` table and Redis from its own structures.
        // Reading `jobs` unconditionally would report an empty queue forever
        // once the broker is Redis. Depth aggregates as the sum of the
        // monitored pools, which are the only queues this deployment writes to;
        // age aggregates as the maximum, because the oldest job overall is the
        // one a stalled pool is holding, not the newest one in a healthy pool.
        $pendingByPool = [];
        $oldestAgeByPool = [];
        foreach (QueueBacklog::pools() as $pool => $queueName) {
            // An unreadable sample is exported as zero but counted in
            // `queue.metrics_unavailable`, so a monitoring gap cannot pass as a
            // genuinely idle queue.
            $pendingByPool[$pool] = QueueBacklog::pending($queueName) ?? 0;
            $oldestAgeByPool[$pool] = QueueBacklog::oldestAgeSeconds($queueName);
        }
        $readableAges = array_values(array_filter($oldestAgeByPool, static fn (?int $age): bool => $age !== null));
        $this->appendGauge($lines, 'uvh_queue_pending_jobs', array_sum($pendingByPool));
        $this->appendGauge($lines, 'uvh_queue_failed_jobs', DB::table('failed_jobs')->count());
        $this->appendGauge($lines, 'uvh_queue_oldest_job_age_seconds', $readableAges === [] ? 0 : max($readableAges));
        foreach (['pending', 'queued', 'processing', 'sent', 'failed', 'obsolete', 'comp_pending', 'compensating', 'compensated'] as $status) {
            $this->appendGauge($lines, 'uvh_mail_outbox_'.$status, DB::table('mail_outbox')->where('status', $status)->count());
        }
        $oldestPendingMail = DB::table('mail_outbox')
            ->whereIn('status', ['pending', 'queued', 'processing', 'comp_pending', 'compensating'])
            ->min('created_at');
        $this->appendGauge(
            $lines,
            'uvh_mail_outbox_oldest_pending_age_seconds',
            $oldestPendingMail === null ? 0 : max(0, time() - Carbon::parse($oldestPendingMail)->getTimestamp()),
        );
        foreach (['pending', 'processing', 'success', 'failed'] as $status) {
            $this->appendGauge($lines, 'uvh_webhook_deliveries_'.$status, DB::table('webhook_deliveries')->where('status', $status)->count());
        }
        // Counts alone cannot distinguish fresh work from a stopped worker.
        // Use creation time because it remains stable through retries and thus
        // measures how long the oldest unresolved event has existed.
        $oldestPendingWebhook = DB::table('webhook_deliveries')
            ->whereIn('status', ['pending', 'processing'])
            ->min('created_at');
        $this->appendGauge(
            $lines,
            'uvh_webhook_oldest_pending_age_seconds',
            $oldestPendingWebhook === null ? 0 : max(0, time() - Carbon::parse($oldestPendingWebhook)->getTimestamp()),
        );
        foreach (['enabled', 'disabled'] as $intent) {
            $this->appendGauge($lines, 'uvh_domains_desired_'.$intent, DB::table('custom_domains')->where('desired_state', $intent)->count());
        }
        foreach (['pending', 'provisioning', 'ready', 'expiring', 'error'] as $status) {
            $this->appendGauge($lines, 'uvh_domains_tls_'.$status, DB::table('custom_domains')->where('tls_status', $status)->count());
        }
        $this->appendGauge(
            $lines,
            'uvh_domains_serving',
            DB::table('custom_domains')->where('desired_state', 'enabled')->where('edge_eligible', true)->whereNotNull('tls_ready_at')->count(),
        );
        // A check is in progress while its start is newer than its completion.
        $oldestDnsCheck = DB::table('custom_domains')
            ->whereNotNull('dns_check_started_at')
            ->where(function ($inProgress) {
                $inProgress->whereNull('dns_check_completed_at')
                    ->orWhereColumn('dns_check_started_at', '>', 'dns_check_completed_at');
            })
            ->min('dns_check_started_at');
        $this->appendGauge(
            $lines,
            'uvh_dns_oldest_in_progress_age_seconds',
            $oldestDnsCheck === null ? 0 : max(0, time() - Carbon::parse($oldestDnsCheck)->getTimestamp()),
        );
        // The standing alarm for the scheduler: a domain the scheduler should
        // already have re-checked and has not. Queue latency is normal; this
        // growing means the round trip is not keeping up with the fleet.
        $overdueCutoff = now()->subHours(max(1, (int) config('uvh.custom_domains.revalidation_hours', 24)));
        $overdueFailureCutoff = now()->subHours(max(1, (int) config('uvh.custom_domains.failure_retry_hours', 1)));
        $overdueDnsChecks = DB::table('custom_domains')
            ->where('desired_state', 'enabled')
            ->where(function ($inProgress) {
                $inProgress->whereNull('dns_check_started_at')
                    ->orWhere('dns_check_completed_at', '>=', DB::raw('dns_check_started_at'));
            })
            ->where(function ($query) use ($overdueCutoff, $overdueFailureCutoff) {
                $query->where(function ($healthy) use ($overdueCutoff) {
                    $healthy->whereNull('dns_error')->where(function ($due) use ($overdueCutoff) {
                        $due->whereNull('dns_check_completed_at')->orWhere('dns_check_completed_at', '<=', $overdueCutoff);
                    });
                })->orWhere(function ($failed) use ($overdueFailureCutoff) {
                    $failed->whereNotNull('dns_error')->where(function ($due) use ($overdueFailureCutoff) {
                        $due->whereNull('dns_check_completed_at')->orWhere('dns_check_completed_at', '<=', $overdueFailureCutoff);
                    });
                });
            })
            ->count();
        $this->appendGauge($lines, 'uvh_dns_overdue_checks', $overdueDnsChecks);
        // Provisioning has no separate claim timestamp. updated_at is written
        // when the generation enters provisioning and is not refreshed while
        // the edge request runs, so it is the appropriate age anchor.
        $oldestTlsProvisioning = DB::table('custom_domains')->where('tls_status', 'provisioning')->min('updated_at');
        $this->appendGauge(
            $lines,
            'uvh_tls_oldest_provisioning_age_seconds',
            $oldestTlsProvisioning === null ? 0 : max(0, time() - Carbon::parse($oldestTlsProvisioning)->getTimestamp()),
        );
        $activePrivacy = DB::table('privacy_rights_requests')->whereIn('status', ['submitted', 'in_progress', 'waiting_user']);
        $this->appendGauge($lines, 'uvh_privacy_requests_active', (clone $activePrivacy)->count());
        $this->appendGauge($lines, 'uvh_privacy_requests_overdue', (clone $activePrivacy)
            ->whereRaw('COALESCE(extended_until, due_at) < NOW()')->count());
        // Destination reputation and the moderation queue it feeds. A growing
        // open-appeal count is what turns "we blocked it" into "and nobody is
        // looking at it".
        $this->appendGauge($lines, 'uvh_denylist_entries', DestinationDenylist::count());
        $this->appendGauge($lines, 'uvh_appeals_open', DB::table('link_appeals')->where('status', 'open')->count());
        $this->appendGauge($lines, 'uvh_reputation_cases_open', DB::table('abuse_reports')
            ->where('source', 'reputation')->where('status', 'open')->count());
        $this->appendGauge($lines, 'uvh_queue_heartbeat_age_seconds', $this->heartbeatAge('queue'));
        foreach (QueueBacklog::pools() as $pool => $queueName) {
            // Per-pool depth/age is what reveals starvation; a healthy generic
            // worker or a small total can otherwise hide one stalled class.
            $this->appendGauge($lines, 'uvh_queue_'.$pool.'_pending_jobs', $pendingByPool[$pool]);
            $this->appendGauge($lines, 'uvh_queue_'.$pool.'_oldest_job_age_seconds', $oldestAgeByPool[$pool] ?? 0);
            $this->appendGauge(
                $lines,
                'uvh_queue_'.$pool.'_heartbeat_age_seconds',
                $this->heartbeatAge('queue-'.$pool),
            );
        }
        $this->appendGauge($lines, 'uvh_scheduler_heartbeat_age_seconds', $this->heartbeatAge('scheduler'));

        return response(implode("\n", $lines)."\n", 200, [
            'Content-Type' => 'text/plain; version=0.0.4; charset=utf-8',
            'Cache-Control' => 'no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /** @param list<string> $lines */
    private function appendGauge(array &$lines, string $name, int $value): void
    {
        $lines[] = '# TYPE '.$name.' gauge';
        $lines[] = $name.' '.max(0, $value);
    }

    private function heartbeatAge(string $component): int
    {
        try {
            $value = Cache::get('uvh:health:'.$component);
            if (! is_int($value) && ! (is_string($value) && ctype_digit($value))) {
                return 86400;
            }

            return max(0, min(86400, time() - (int) $value));
        } catch (\Throwable) {
            return 86400;
        }
    }
}
