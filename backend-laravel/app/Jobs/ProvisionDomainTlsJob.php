<?php

namespace App\Jobs;

use App\Models\CustomDomain;
use App\Support\Audit;
use App\Support\DomainEvents;
use App\Support\DomainStatus;
use App\Support\EdgeTlsProbe;
use App\Support\OperationalMetrics;
use App\Support\WorkspaceAccess;
use Carbon\CarbonInterface;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Issue and validate the TLS certificate for one custom domain.
 *
 * The probe forces SNI = the customer hostname while connecting to the edge IP
 * pinned inside the private network (`CURLOPT_RESOLVE`), keeping peer and host
 * verification on: what answers is exactly what a visitor would get, from the
 * only network path the platform controls. Nothing here manages certificates —
 * Caddy does — this proves the result works.
 *
 * Authorization follows the execution semantics: the actor that started the
 * operation is re-validated, with its API token scope and security version,
 * before the result is applied. An unattended recovery carries no actor and is
 * guarded by the TLS generation and the domain's intent instead.
 */
final class ProvisionDomainTlsJob implements ShouldQueue
{
    use Dispatchable;
    use Queueable;

    public int $tries = 5;

    public int $timeout = 50;

    public bool $failOnTimeout = true;

    /** @var array<int, int> */
    public array $backoff = [30, 120, 300, 900];

    public function __construct(
        public int $domainId,
        public int $workspaceId,
        public ?int $requestedBy,
        public ?int $actorSecurityVersion,
        public ?int $apiTokenId,
        public string $domain,
        public int $tlsVersion,
    ) {
        $this->onQueue('domains');
    }

    public function handle(): void
    {
        $eligible = CustomDomain::where('id', $this->domainId)
            ->where('workspace_id', $this->workspaceId)
            ->where('domain', $this->domain)
            ->where('tls_status', 'provisioning')
            ->where('edge_eligible', true)
            ->where('tls_version', $this->tlsVersion)
            ->exists();
        if (! $eligible) {
            return;
        }
        if ($this->requestedBy !== null && ! $this->actorStillAuthorized()) {
            $this->cancel();

            return;
        }

        $cert = $this->probeCertificate();

        $eventIds = [];
        $activated = DB::transaction(function () use (&$eventIds, $cert): bool {
            $authorized = $this->requestedBy === null
                ? true
                : WorkspaceAccess::getMembershipLocked(
                    $this->requestedBy,
                    $this->workspaceId,
                    'editor',
                    $this->apiTokenContext(),
                    'domains:write',
                    $this->actorSecurityVersion,
                ) !== null;
            $domain = CustomDomain::where('id', $this->domainId)
                ->where('workspace_id', $this->workspaceId)
                ->where('domain', $this->domain)
                ->where('tls_version', $this->tlsVersion)
                ->lockForUpdate()
                ->first();
            if (! $domain || $domain->tls_status !== 'provisioning' || ! $domain->edge_eligible) {
                return false;
            }
            if (! $authorized || $domain->desired_state !== 'enabled') {
                $domain->update([
                    'tls_status' => 'error',
                    'edge_eligible' => false,
                    'tls_error' => 'provisioning_cancelled',
                    'updated_at' => now(),
                ]);

                return false;
            }

            $domain->update([
                // A certificate already inside the expiry window is served but
                // flagged: Caddy must renew it, and the platform now watches.
                'tls_status' => DomainStatus::tlsExpiryStatus($cert['notAfter']),
                'tls_ready_at' => now(),
                'tls_error' => null,
                'tls_next_retry_at' => null,
                'tls_checked_at' => now(),
                'tls_not_after' => $cert['notAfter'],
                'tls_issuer' => $cert['issuer'],
                'tls_probe_failures' => 0,
                'edge_eligible' => true,
                'updated_at' => now(),
            ]);
            $eventIds[] = DomainEvents::record($this->workspaceId, $this->domainId, $this->domain, 'domain.activated', [
                'domainId' => $this->domainId,
                'domain' => $this->domain,
            ]);

            return true;
        });

        if ($activated) {
            OperationalMetrics::increment('tls.ready');
            try {
                Audit::write($this->requestedBy, 'domain.activate', 'domain', $this->domainId, [
                    'tls_provisioned' => true,
                ], workspaceId: $this->workspaceId);
            } catch (Throwable $e) {
                // The certificate and state transition are already complete;
                // an audit sink outage must not trigger another issuance.
                report($e);
            }
        }
        DomainEvents::scheduleDispatch($eventIds);
    }

    public function failed(?Throwable $exception): void
    {
        $autoRetryHours = max(1, (int) config('uvh.custom_domains.tls_auto_retry_hours', 6));
        $updated = CustomDomain::where('id', $this->domainId)
            ->where('workspace_id', $this->workspaceId)
            ->where('domain', $this->domain)
            ->where('tls_status', 'provisioning')
            ->where('tls_version', $this->tlsVersion)
            ->update([
                'tls_status' => 'error',
                'edge_eligible' => false,
                'tls_ready_at' => null,
                'tls_error' => 'certificate_provisioning_failed',
                // Automatic retry keeps its distance from the CA: a domain
                // whose CAA or DNS is permanently broken must not become a
                // hammer. The sweep picks it up when this is due.
                'tls_next_retry_at' => now()->addHours($autoRetryHours),
                'updated_at' => now(),
            ]);
        if ($updated > 0) {
            OperationalMetrics::increment('tls.failed');
            $eventIds = [];
            try {
                $eventIds[] = DB::transaction(fn (): int => DomainEvents::record($this->workspaceId, $this->domainId, $this->domain, 'domain.tls_failed', [
                    'domainId' => $this->domainId,
                    'domain' => $this->domain,
                    'reason' => 'certificate_provisioning_failed',
                ]));
                Audit::write($this->requestedBy, 'domain.tls_failed', 'domain', $this->domainId, [
                    'exception' => $exception ? $exception::class : null,
                ], workspaceId: $this->workspaceId);
            } catch (Throwable $e) {
                report($e);
            }
            DomainEvents::scheduleDispatch($eventIds);
        }
    }

    private function actorStillAuthorized(): bool
    {
        return DB::transaction(fn (): bool => WorkspaceAccess::getMembershipLocked(
            (int) $this->requestedBy,
            $this->workspaceId,
            'editor',
            $this->apiTokenContext(),
            'domains:write',
            $this->actorSecurityVersion,
        ) !== null);
    }

    private function cancel(): void
    {
        CustomDomain::where('id', $this->domainId)
            ->where('workspace_id', $this->workspaceId)
            ->where('tls_status', 'provisioning')
            ->where('tls_version', $this->tlsVersion)
            ->update([
                'tls_status' => 'error',
                'edge_eligible' => false,
                'tls_error' => 'provisioning_cancelled',
                'updated_at' => now(),
            ]);
    }

    /**
     * Prove the issued certificate works and keep the facts about its
     * lifetime. First-party health answers with the service JSON, a branded
     * custom host with 204; both mean the handshake and the route work.
     *
     * @return array{notAfter: CarbonInterface|null, issuer: ?string}
     */
    private function probeCertificate(): array
    {
        $probe = EdgeTlsProbe::probe($this->domain);
        if ($probe['status'] < 200 || $probe['status'] >= 300) {
            throw new \RuntimeException('El edge TLS no confirmó el certificado');
        }

        return [
            'notAfter' => $probe['cert']['notAfter'] ?? null,
            'issuer' => $probe['cert']['issuer'] ?? null,
        ];
    }

    /** @return array{token_id: int}|null */
    private function apiTokenContext(): ?array
    {
        return $this->apiTokenId === null ? null : ['token_id' => $this->apiTokenId];
    }
}
