<?php

namespace App\Jobs;

use App\Models\CustomDomain;
use App\Support\DomainEvents;
use App\Support\DomainStatus;
use App\Support\EdgeTlsProbe;
use App\Support\OperationalMetrics;
use Carbon\CarbonInterface;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Watch one active custom domain's certificate after issuance.
 *
 * Caddy renews certificates on its own; nothing inside the platform used to
 * notice when that stopped happening. This probe re-runs the same handshake
 * through the edge and records what the certificate says about itself — the
 * expiry Caddy must beat and the issuer — so an unrenewed certificate surfaces
 * as `expiring` (and later as an event) instead of as a customer outage.
 *
 * Deliberately narrow in what it judges: only the handshake decides. An HTTP
 * error from the platform's own health route is not evidence against the
 * certificate, and a platform outage must never withdraw customer domains.
 * Sustained handshake failure (or an expired certificate) withdraws the
 * domain, with the same failure budget the DNS checks use.
 *
 * Each job belongs to one monitoring round: the housekeeping sweep claims the
 * row (`tls_probe_version` generation) before dispatching, and only the
 * current, still-open round may write. A delayed queue cannot turn one
 * incident into several probe failures — the copies of a superseded or
 * already-closed round write nothing.
 */
final class ProbeDomainTlsJob implements ShouldQueue
{
    use Dispatchable;
    use Queueable;

    public int $tries = 2;

    public int $timeout = 60;

    public bool $failOnTimeout = true;

    /** @var array<int, int> */
    public array $backoff = [60];

    public function __construct(
        public int $domainId,
        public int $workspaceId,
        public string $domain,
        public int $tlsProbeVersion,
    ) {
        $this->onQueue('domains');
    }

    public function handle(): void
    {
        $eligible = CustomDomain::where('id', $this->domainId)
            ->where('workspace_id', $this->workspaceId)
            ->where('domain', $this->domain)
            ->where('desired_state', 'enabled')
            ->where('edge_eligible', true)
            ->whereIn('tls_status', ['ready', 'expiring'])
            ->exists();
        if (! $eligible) {
            return;
        }

        try {
            $probe = EdgeTlsProbe::probe($this->domain);
        } catch (Throwable $e) {
            // A probe that cannot even run is a failed probe: same budget.
            report($e);
            $probe = ['status' => 0, 'cert' => null];
        }

        $this->apply($probe);
    }

    /**
     * @param  array{status: int, cert: array{notAfter: CarbonInterface|null, issuer: ?string}|null}  $probe
     */
    private function apply(array $probe): void
    {
        $eventIds = [];
        $outcome = DB::transaction(function () use ($probe, &$eventIds): ?string {
            $domain = CustomDomain::where('id', $this->domainId)
                ->where('workspace_id', $this->workspaceId)
                ->where('domain', $this->domain)
                ->whereIn('tls_status', ['ready', 'expiring'])
                ->lockForUpdate()
                ->first();
            if (! $domain) {
                return null;
            }
            // Only the current, still-open monitoring round may write. A
            // duplicate of this round (same generation) and a stale job from a
            // superseded one must both write nothing: one incident is one
            // probe failure, never one per copy of the job.
            if ((int) $domain->tls_probe_version !== $this->tlsProbeVersion
                || $domain->tls_probe_completed_at !== null) {
                return null;
            }

            $now = now();
            $notAfter = $probe['cert']['notAfter'] ?? null;
            $handshakeOk = $probe['status'] > 0 && $probe['cert'] !== null;
            $expired = $handshakeOk && $notAfter !== null && $notAfter->lte($now);

            if ($handshakeOk && ! $expired) {
                $status = DomainStatus::tlsExpiryStatus($notAfter);
                $becameExpiring = $status === 'expiring' && $domain->tls_status !== 'expiring';
                $domain->update([
                    'tls_status' => $status,
                    'tls_checked_at' => $now,
                    'tls_probe_completed_at' => $now,
                    'tls_not_after' => $notAfter,
                    'tls_issuer' => $probe['cert']['issuer'],
                    'tls_error' => null,
                    'tls_probe_failures' => 0,
                    'updated_at' => $now,
                ]);
                if ($becameExpiring) {
                    $eventIds[] = DomainEvents::record($this->workspaceId, $this->domainId, $this->domain, 'domain.tls_expiring', [
                        'domainId' => $this->domainId,
                        'domain' => $this->domain,
                        'notAfter' => $notAfter?->toIso8601String(),
                        'daysRemaining' => $notAfter === null ? null : max(0, (int) $now->diffInDays($notAfter, false)),
                    ]);
                }

                return 'ok';
            }

            $failures = (int) $domain->tls_probe_failures + 1;
            $maxFailures = max(2, min(10, (int) config('uvh.custom_domains.max_failures', 3)));
            $withdraw = $expired || $failures >= $maxFailures;
            $domain->update([
                'tls_status' => $withdraw ? 'error' : $domain->tls_status,
                'edge_eligible' => $withdraw ? false : (bool) $domain->edge_eligible,
                'tls_ready_at' => $withdraw ? null : $domain->tls_ready_at,
                'tls_error' => $expired ? 'certificate_expired' : ($withdraw ? 'certificate_probe_failed' : 'certificate_check_failed'),
                'tls_checked_at' => $now,
                'tls_probe_completed_at' => $now,
                'tls_not_after' => $notAfter ?? $domain->tls_not_after,
                'tls_probe_failures' => $failures,
                'updated_at' => $now,
            ]);
            if ($withdraw) {
                $eventIds[] = DomainEvents::record($this->workspaceId, $this->domainId, $this->domain, 'domain.tls_failed', [
                    'domainId' => $this->domainId,
                    'domain' => $this->domain,
                    'reason' => $expired ? 'certificate_expired' : 'certificate_probe_failed',
                ]);
            }

            return $withdraw ? 'withdrawn' : 'degraded';
        });

        if ($outcome === 'ok') {
            OperationalMetrics::increment('tls.probe.ok');
        } elseif ($outcome !== null) {
            OperationalMetrics::increment('tls.probe.failed');
        }
        DomainEvents::scheduleDispatch($eventIds);
    }
}
