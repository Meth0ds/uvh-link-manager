<?php

namespace App\Http\Controllers;

use App\Support\OperationalMetrics;
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

        $this->appendGauge($lines, 'uvh_queue_pending_jobs', DB::table('jobs')->count());
        $this->appendGauge($lines, 'uvh_queue_failed_jobs', DB::table('failed_jobs')->count());
        $oldestJob = DB::table('jobs')->min('created_at');
        $this->appendGauge($lines, 'uvh_queue_oldest_job_age_seconds', $oldestJob === null ? 0 : max(0, time() - (int) $oldestJob));
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
        foreach (['pending', 'verifying', 'verified', 'provisioning', 'active', 'error', 'disabled'] as $state) {
            $this->appendGauge($lines, 'uvh_domains_'.$state, DB::table('custom_domains')->where('state', $state)->count());
        }
        // Revalidation deliberately keeps the public state active/verified/
        // disabled. The timestamp comparison is therefore the authoritative
        // in-progress marker, while updated_at covers legacy verifying rows
        // created before dns_check_started_at existed.
        $oldestDnsCheck = DB::table('custom_domains')
            ->where(function ($query) {
                $query->where('state', 'verifying')
                    ->orWhere(function ($revalidation) {
                        $revalidation->whereIn('state', ['active', 'verified', 'disabled'])
                            ->whereNotNull('dns_check_started_at')
                            ->where(function ($inProgress) {
                                $inProgress->whereNull('dns_check_completed_at')
                                    ->orWhereColumn('dns_check_started_at', '>', 'dns_check_completed_at');
                            });
                    });
            })
            ->min(DB::raw('COALESCE(dns_check_started_at, updated_at)'));
        $this->appendGauge(
            $lines,
            'uvh_dns_oldest_in_progress_age_seconds',
            $oldestDnsCheck === null ? 0 : max(0, time() - Carbon::parse($oldestDnsCheck)->getTimestamp()),
        );
        // Provisioning has no separate claim timestamp. updated_at is written
        // when the generation enters provisioning and is not refreshed while
        // the edge request runs, so it is the appropriate age anchor.
        $oldestTlsProvisioning = DB::table('custom_domains')->where('state', 'provisioning')->min('updated_at');
        $this->appendGauge(
            $lines,
            'uvh_tls_oldest_provisioning_age_seconds',
            $oldestTlsProvisioning === null ? 0 : max(0, time() - Carbon::parse($oldestTlsProvisioning)->getTimestamp()),
        );
        $activePrivacy = DB::table('privacy_rights_requests')->whereIn('status', ['submitted', 'in_progress', 'waiting_user']);
        $this->appendGauge($lines, 'uvh_privacy_requests_active', (clone $activePrivacy)->count());
        $this->appendGauge($lines, 'uvh_privacy_requests_overdue', (clone $activePrivacy)
            ->whereRaw('COALESCE(extended_until, due_at) < NOW()')->count());
        $this->appendGauge($lines, 'uvh_queue_heartbeat_age_seconds', $this->heartbeatAge('queue'));
        foreach (['mail', 'webhooks', 'domains', 'exports', 'analytics', 'legacy'] as $pool) {
            $queueName = $pool === 'legacy' ? 'default' : $pool;
            // Per-pool depth/age is what reveals starvation; a healthy generic
            // worker or a small total can otherwise hide one stalled class.
            $poolJobs = DB::table('jobs')->where('queue', $queueName);
            $oldestPoolJob = (clone $poolJobs)->min('created_at');
            $this->appendGauge($lines, 'uvh_queue_'.$pool.'_pending_jobs', (clone $poolJobs)->count());
            $this->appendGauge(
                $lines,
                'uvh_queue_'.$pool.'_oldest_job_age_seconds',
                $oldestPoolJob === null ? 0 : max(0, time() - (int) $oldestPoolJob),
            );
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
