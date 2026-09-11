<?php

namespace App\Jobs;

use App\Models\CustomDomain;
use App\Support\Audit;
use App\Support\OperationalMetrics;
use App\Support\PrivateIpv4Network;
use App\Support\WorkspaceAccess;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Support\Facades\DB;
use Throwable;

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
        public int $requestedBy,
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
            ->where('state', 'provisioning')
            ->where('edge_eligible', true)
            ->where('tls_version', $this->tlsVersion)
            ->exists();
        if (! $eligible) {
            return;
        }
        $membership = WorkspaceAccess::getMembership($this->requestedBy, $this->workspaceId);
        if (! $membership || ! WorkspaceAccess::roleAtLeast($membership->role, 'editor')) {
            CustomDomain::where('id', $this->domainId)
                ->where('workspace_id', $this->workspaceId)
                ->where('state', 'provisioning')
                ->where('tls_version', $this->tlsVersion)
                ->update([
                    'state' => 'verified',
                    'edge_eligible' => false,
                    'tls_error' => 'provisioning_cancelled',
                    'updated_at' => now(),
                ]);

            return;
        }

        $this->requestCertificateThroughEdge();

        $activated = DB::transaction(function (): bool {
            $membership = WorkspaceAccess::getMembershipLocked($this->requestedBy, $this->workspaceId, 'editor');
            $domain = CustomDomain::where('id', $this->domainId)
                ->where('workspace_id', $this->workspaceId)
                ->where('domain', $this->domain)
                ->where('tls_version', $this->tlsVersion)
                ->lockForUpdate()
                ->first();
            if (! $domain || $domain->state !== 'provisioning' || ! $domain->edge_eligible) {
                return false;
            }
            if (! $membership) {
                $domain->update([
                    'state' => 'verified',
                    'edge_eligible' => false,
                    'tls_error' => 'provisioning_cancelled',
                    'updated_at' => now(),
                ]);

                return false;
            }

            $domain->update([
                'state' => 'active',
                'edge_eligible' => true,
                'tls_ready_at' => now(),
                'tls_error' => null,
                'updated_at' => now(),
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
    }

    public function failed(?Throwable $exception): void
    {
        $updated = CustomDomain::where('id', $this->domainId)
            ->where('workspace_id', $this->workspaceId)
            ->where('domain', $this->domain)
            ->where('state', 'provisioning')
            ->where('tls_version', $this->tlsVersion)
            ->update([
                'state' => 'verified',
                'edge_eligible' => false,
                'tls_ready_at' => null,
                'tls_error' => 'certificate_provisioning_failed',
                'updated_at' => now(),
            ]);
        if ($updated > 0) {
            OperationalMetrics::increment('tls.failed');
            try {
                Audit::write($this->requestedBy, 'domain.tls_failed', 'domain', $this->domainId, [
                    'exception' => $exception ? $exception::class : null,
                ], workspaceId: $this->workspaceId);
            } catch (Throwable $e) {
                report($e);
            }
        }
    }

    private function requestCertificateThroughEdge(): void
    {
        $edgeHost = strtolower((string) config('uvh.custom_domains.edge_internal_host', 'edge'));
        $edgeIp = gethostbyname($edgeHost);
        if ($edgeIp === $edgeHost
            || filter_var($edgeIp, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false
            || ! PrivateIpv4Network::contains(
                $edgeIp,
                (array) config('uvh.custom_domains.edge_internal_cidrs', []),
            )) {
            throw new \RuntimeException('No se pudo resolver el edge TLS interno');
        }

        $handle = curl_init('https://'.$this->domain.'/health');
        if ($handle === false) {
            throw new \RuntimeException('No se pudo iniciar la comprobación TLS');
        }

        curl_setopt_array($handle, [
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 45,
            CURLOPT_NOSIGNAL => true,
            CURLOPT_PROXY => '',
            CURLOPT_NOPROXY => '*',
            CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_RESOLVE => [$this->domain.':443:'.$edgeIp],
            CURLOPT_USERAGENT => 'UVH-TLS-Provisioner/1.0',
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
            CURLOPT_WRITEFUNCTION => static fn ($curl, string $chunk): int => strlen($chunk),
            CURLOPT_HEADERFUNCTION => static fn ($curl, string $header): int => strlen($header),
        ]);

        try {
            $ok = curl_exec($handle);
            $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
            if ($ok === false || $status !== 200) {
                throw new \RuntimeException('El edge TLS no confirmó el certificado');
            }
        } finally {
            curl_close($handle);
        }
    }
}
