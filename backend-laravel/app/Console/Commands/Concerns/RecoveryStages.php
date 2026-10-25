<?php

namespace App\Console\Commands\Concerns;

use App\Jobs\ProbeDomainTlsJob;
use App\Jobs\VerifyDomainDnsJob;
use App\Models\CustomDomain;
use App\Models\Link;
use App\Models\User;
use App\Support\DestinationReputationService;
use App\Support\DomainRevalidationSchedule;
use App\Support\DomainStatus;
use App\Support\Ids;
use App\Support\MailOutboxCompensation;
use App\Support\MailOutboxDispatcher;
use App\Support\OperationalMetrics;
use App\Support\ReputationVerdict;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

trait RecoveryStages
{
    /** Recover queue publication/worker crashes and admit a bounded mail batch. */
    private function recoverAndQueueMailOutbox(): void
    {
        $stale = now()->subMinutes(10);
        DB::table('mail_outbox')
            ->where('status', 'queued')
            ->where('queued_at', '<=', $stale)
            ->update([
                'status' => 'pending',
                'queued_at' => null,
                'available_at' => now(),
                'last_error' => 'queue_timeout',
                'updated_at' => now(),
            ]);
        DB::table('mail_outbox')
            ->where('status', 'processing')
            ->where('locked_at', '<=', $stale)
            ->update([
                'status' => 'pending',
                'locked_at' => null,
                'lock_token' => null,
                'available_at' => now(),
                'last_error' => 'worker_timeout',
                'updated_at' => now(),
            ]);
        DB::table('mail_outbox')
            ->where('status', 'compensating')
            ->where('locked_at', '<=', $stale)
            ->update([
                'status' => 'comp_pending',
                'locked_at' => null,
                'lock_token' => null,
                'available_at' => now(),
                'last_error' => 'compensation_timeout',
                'updated_at' => now(),
            ]);

        $compensations = DB::table('mail_outbox')
            ->where('status', 'comp_pending')->where('available_at', '<=', now())
            ->orderBy('available_at')->orderBy('id')->limit(25)->pluck('id');
        foreach ($compensations as $id) {
            MailOutboxCompensation::attempt((int) $id);
        }

        $ids = DB::table('mail_outbox')
            ->where('status', 'pending')
            ->where('available_at', '<=', now())
            ->orderBy('available_at')
            ->orderBy('id')
            ->limit(50)
            ->pluck('id');
        foreach ($ids as $id) {
            MailOutboxDispatcher::enqueue((int) $id);
        }
    }

    /**
     * Re-analyse destinations whose verdict is missing or stale, and refresh the
     * reputation of the platform's own hosts.
     *
     * Both halves are skipped when no provider is configured: without one there
     * is nothing to ask and nothing to refresh, and sweeping anyway would spin
     * a job per link per tick for a verdict that cannot change. Applying a new
     * denylist entry is not this sweep's job — that is dispatched the moment the
     * entry is created, so existing links are reached immediately.
     */
    private function queueDestinationRechecks(): void
    {
        if (! DestinationReputationService::provider()->configured()) {
            return;
        }

        $batch = max(1, min(500, (int) config('uvh.reputation.recheck_batch', 50)));
        // `staleLinkIds()` returns link ids on purpose. A shared destination has
        // one cached verdict, but each link still needs its own decision: the
        // block/release transition is versioned per row and audits that row's
        // workspace. One job per link is the unit of that decision; a hash-level
        // job would still have to fan out to every link to apply it.
        foreach (DestinationReputationService::staleLinkIds($batch) as $linkId) {
            DestinationReputationService::dispatchCheck((int) $linkId);
        }

        if (! (bool) config('uvh.reputation.domain_monitor', true)) {
            return;
        }

        // A short blocklist that can take the whole domain offline deserves a
        // standing signal, not a manual check after the phone rings. The batch
        // rotates through the least recently monitored domains: with more
        // domains than fit in one batch, every domain still gets monitored
        // instead of the same first rows being re-read forever.
        $hosts = [(string) config('uvh.public_host'), (string) config('uvh.app_host')];
        $batch = max(1, min(100, (int) config('uvh.reputation.domain_monitor_batch', 25)));
        $monitored = [];
        $custom = DB::table('custom_domains')
            ->where('desired_state', 'enabled')
            ->orderByRaw('reputation_checked_at NULLS FIRST')
            ->orderBy('id')
            ->limit($batch)
            ->get(['id', 'domain']);
        foreach ($custom as $row) {
            if (is_string($row->domain) && trim($row->domain) !== '') {
                $hosts[] = $row->domain;
                $monitored[] = (int) $row->id;
            }
        }

        foreach (array_unique($hosts) as $host) {
            if (trim($host) === '') {
                continue;
            }
            $verdict = DestinationReputationService::monitorHost($host);
            if (in_array($verdict->verdict(), [ReputationVerdict::MALICIOUS, ReputationVerdict::SUSPICIOUS], true)) {
                OperationalMetrics::increment('reputation.domain_listed');
            }
        }
        if ($monitored !== []) {
            // The rotation marker only: `updated_at` anchors the stale-job
            // recovery sweeps and must not be refreshed by monitoring.
            DB::table('custom_domains')->whereIn('id', $monitored)->update(['reputation_checked_at' => now()]);
        }
    }

    /**
     * Release a bounded batch of self-applied destination blocks that no longer
     * have a reason.
     *
     * A denylist entry can stop applying without anyone acting: `expires_at`
     * passes while the links it blocked stay blocked, and a temporary block that
     * outlives its entry is a permanent one. Moderator decisions carry no marker
     * and are not part of the batch.
     */
    private function releaseUnlistedBlocks(): void
    {
        $batch = max(1, min(500, (int) config('uvh.reputation.release_batch', 50)));
        DestinationReputationService::releaseUnlistedBlocks($batch);
    }

    private function queueDomainRevalidations(): void
    {
        $healthyCutoff = now()->subHours(max(1, (int) config('uvh.custom_domains.revalidation_hours', 24)));
        $failureCutoff = now()->subHours(max(1, (int) config('uvh.custom_domains.failure_retry_hours', 1)));

        // Intent, not health: every domain the user wants enabled is checked,
        // including one that fell to `failed`. That is what makes a repaired
        // DNS configuration come back without anyone opening the panel.
        $dueDomains = CustomDomain::where('desired_state', 'enabled')
            ->where(function ($query) {
                $query->whereNull('dns_check_started_at')
                    ->orWhereColumn('dns_check_completed_at', '>=', 'dns_check_started_at');
            })
            ->where(function ($query) use ($healthyCutoff, $failureCutoff) {
                $query->where(function ($healthy) use ($healthyCutoff) {
                    $healthy->whereNull('dns_error')
                        ->where(function ($due) use ($healthyCutoff) {
                            $due->whereNull('dns_check_completed_at')
                                ->orWhere('dns_check_completed_at', '<=', $healthyCutoff);
                        });
                })->orWhere(function ($failed) use ($failureCutoff) {
                    $failed->whereNotNull('dns_error')
                        ->where(function ($due) use ($failureCutoff) {
                            $due->whereNull('dns_check_completed_at')
                                ->orWhere('dns_check_completed_at', '<=', $failureCutoff);
                        });
                });
            })
            ->orderByRaw('dns_check_completed_at NULLS FIRST')
            ->orderBy('id')
            ->limit(max(1, min(500, (int) config('uvh.custom_domains.revalidation_batch', 20))))
            ->get(['id', 'workspace_id']);

        foreach ($dueDomains as $dueDomain) {
            $id = (int) $dueDomain->id;
            $workspaceId = (int) $dueDomain->workspace_id;
            $dedupeKey = 'uvh:domain-verification:'.$workspaceId.':'.$id;
            $lock = Cache::lock($dedupeKey, 600);
            if (! $lock->get()) {
                continue;
            }

            $dispatched = false;
            try {
                $prepared = DB::transaction(function () use ($id, $workspaceId): ?array {
                    $domain = CustomDomain::where('id', $id)
                        ->where('workspace_id', $workspaceId)
                        ->where('desired_state', 'enabled')
                        ->lockForUpdate()
                        ->first();
                    if (! $domain || $this->dnsCheckInProgress($domain) || ! $this->dnsCheckDue($domain)) {
                        return null;
                    }

                    $updates = DomainStatus::beginDnsCheck($domain);
                    $domain->update($updates);

                    return [
                        'domain' => $domain->domain,
                        'token' => $domain->verification_token,
                        'scheme' => (int) $domain->verification_scheme,
                        'version' => $updates['verification_version'],
                    ];
                });
                if (! $prepared) {
                    continue;
                }

                try {
                    VerifyDomainDnsJob::dispatch(
                        (int) $id,
                        $workspaceId,
                        null,
                        null,
                        null,
                        $prepared['domain'],
                        $prepared['token'],
                        $prepared['scheme'],
                        $prepared['version'],
                        $dedupeKey,
                        $lock->owner(),
                    )->afterCommit();
                    $dispatched = true;
                } catch (\Throwable $e) {
                    CustomDomain::where('id', $id)
                        ->where('workspace_id', $workspaceId)
                        ->where('verification_version', $prepared['version'])
                        ->update([
                            'dns_check_completed_at' => now(),
                            'dns_error' => 'queue_unavailable',
                            'updated_at' => now(),
                        ]);
                    report($e);
                }
            } finally {
                if (! $dispatched) {
                    try {
                        $lock->release();
                    } catch (\Throwable $e) {
                        // A bounded orphaned lease is less harmful than
                        // aborting all remaining retention and recovery work.
                        OperationalMetrics::increment('lock.unavailable');
                        report($e);
                    }
                }
            }
        }
    }

    /**
     * Re-prove the certificates of serving domains on a rotation.
     *
     * Caddy renews certificates by itself; this is the platform noticing when
     * it does not. The batch rotates through the least recently probed domains
     * so a fleet larger than one batch is still fully covered, and only the
     * handshake speaks against a certificate — a platform outage must never
     * withdraw customer domains (the job itself enforces that).
     *
     * Each row is **claimed** before dispatch: the claim opens one monitoring
     * round (`tls_probe_version` generation) and every later pass skips the
     * row until the round closes or its lease expires. Without this, a delayed
     * `domains` queue made each minute's pass enqueue the same round again and
     * three copies of one incident could count as three probe failures —
     * enough to withdraw a domain that was actually serving.
     */
    private function queueTlsProbeChecks(): void
    {
        $cutoff = now()->subHours(max(1, (int) config('uvh.custom_domains.tls_probe_interval_hours', 24)));
        $batch = max(1, min(100, (int) config('uvh.custom_domains.tls_probe_batch', 20)));
        // A claimed round holds the row for at least an hour; a job lost with
        // the queue is recovered when the lease expires.
        $leaseBefore = now()->subHours(1);

        $rows = DB::table('custom_domains')
            ->where('desired_state', 'enabled')
            ->where('edge_eligible', true)
            ->whereIn('tls_status', ['ready', 'expiring'])
            ->where(function ($query) use ($cutoff) {
                $query->whereNull('tls_checked_at')->orWhere('tls_checked_at', '<=', $cutoff);
            })
            ->where(function ($query) use ($leaseBefore) {
                $query->whereNull('tls_probe_started_at')
                    ->orWhereNotNull('tls_probe_completed_at')
                    ->orWhere('tls_probe_started_at', '<=', $leaseBefore);
            })
            ->orderByRaw('tls_checked_at NULLS FIRST')
            ->orderBy('id')
            ->limit($batch)
            ->get(['id', 'workspace_id', 'domain']);

        foreach ($rows as $row) {
            try {
                // The atomic claim elects one dispatcher per round even if two
                // housekeeping runs overlap.
                $claimed = DB::table('custom_domains')
                    ->where('id', $row->id)
                    ->where('desired_state', 'enabled')
                    ->where('edge_eligible', true)
                    ->whereIn('tls_status', ['ready', 'expiring'])
                    ->where(function ($query) use ($cutoff) {
                        $query->whereNull('tls_checked_at')->orWhere('tls_checked_at', '<=', $cutoff);
                    })
                    ->where(function ($query) use ($leaseBefore) {
                        $query->whereNull('tls_probe_started_at')
                            ->orWhereNotNull('tls_probe_completed_at')
                            ->orWhere('tls_probe_started_at', '<=', $leaseBefore);
                    })
                    ->update([
                        'tls_probe_version' => DB::raw('tls_probe_version + 1'),
                        'tls_probe_started_at' => now(),
                        'tls_probe_completed_at' => null,
                        'updated_at' => now(),
                    ]);
                if ($claimed !== 1) {
                    continue;
                }
                $version = (int) DB::table('custom_domains')->where('id', $row->id)->value('tls_probe_version');
                ProbeDomainTlsJob::dispatch(
                    (int) $row->id,
                    (int) $row->workspace_id,
                    (string) $row->domain,
                    $version,
                )->afterCommit();
            } catch (\Throwable $e) {
                // The next sweep retries; monitoring must never break the
                // rest of housekeeping.
                report($e);
            }
        }
    }

    private function dnsCheckInProgress(CustomDomain $domain): bool
    {
        return DomainRevalidationSchedule::isInProgress($domain);
    }

    private function dnsCheckDue(CustomDomain $domain): bool
    {
        return DomainRevalidationSchedule::isDue($domain);
    }
}
