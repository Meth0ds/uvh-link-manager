<?php

namespace App\Jobs;

use App\Models\CustomDomain;
use App\Support\Audit;
use App\Support\OperationalMetrics;
use App\Support\WebhookService;
use App\Support\WorkspaceAccess;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

class VerifyDomainDnsJob implements ShouldQueue
{
    use Dispatchable;
    use Queueable;

    public int $tries = 3;

    public int $timeout = 15;

    public bool $failOnTimeout = true;

    /** @var array<int, int> */
    public array $backoff = [15, 60];

    public function __construct(
        public int $domainId,
        public int $workspaceId,
        public ?int $requestedBy,
        public string $domain,
        public string $verificationToken,
        public string $previousState,
        public int $verificationVersion,
        public string $dedupeKey,
        public string $dedupeOwner,
    ) {
        $this->onQueue('domains');
    }

    public function handle(): void
    {
        $dns = $this->checkDns();
        $result = DB::transaction(function () use ($dns): ?array {
            $membership = $this->requestedBy === null
                ? true
                : WorkspaceAccess::getMembershipLocked($this->requestedBy, $this->workspaceId, 'editor') !== null;
            $domain = CustomDomain::where('id', $this->domainId)
                ->where('workspace_id', $this->workspaceId)->lockForUpdate()->first();
            if (! $domain || $domain->domain !== $this->domain || $domain->verification_token !== $this->verificationToken) {
                return null;
            }
            if ((int) $domain->verification_version !== $this->verificationVersion) {
                return null;
            }
            $expectedState = $this->previousState === 'pending' || $this->previousState === 'error'
                ? 'verifying'
                : $this->previousState;
            if ($domain->state !== $expectedState) {
                return null;
            }
            if (! $membership) {
                $cancelled = [
                    'dns_check_completed_at' => now(),
                    'dns_error' => 'verification_cancelled',
                    'updated_at' => now(),
                ];
                if ($domain->state === 'verifying') {
                    $cancelled['state'] = $this->previousState;
                }
                $domain->update($cancelled);

                return null;
            }

            $now = now();
            $found = $dns['ownership'] && $dns['routing'];
            $failureCount = $found ? 0 : (int) $domain->dns_failure_count + 1;
            $firstFailedAt = $found ? null : ($domain->dns_first_failed_at ?? $now);
            $graceHours = max(1, min(24, (int) config('uvh.custom_domains.failure_grace_hours', 2)));
            $maxFailures = max(2, min(10, (int) config('uvh.custom_domains.max_failures', 3)));
            $wasEdgeEligible = (bool) $domain->edge_eligible;
            $withinActiveGrace = $this->previousState === 'active'
                && $wasEdgeEligible
                && ($failureCount < $maxFailures
                    || $firstFailedAt->gt($now->copy()->subHours($graceHours)));
            $nextState = $found
                ? ($this->previousState === 'active' && $wasEdgeEligible ? 'active' : 'verified')
                : ($withinActiveGrace ? 'active' : 'error');
            $nextEdgeEligibility = $found
                ? $this->previousState === 'active' && $wasEdgeEligible
                : ($withinActiveGrace && (bool) $domain->edge_eligible);
            $updates = [
                'state' => $nextState,
                'verified_at' => $found ? $now : ($withinActiveGrace ? $domain->verified_at : null),
                'ownership_verified_at' => $dns['ownership'] ? $now : null,
                'routing_verified_at' => $dns['routing'] ? $now : null,
                'dns_check_completed_at' => $now,
                'dns_error' => $found ? null : $dns['error'],
                'dns_failure_count' => $failureCount,
                'dns_first_failed_at' => $firstFailedAt,
                'edge_eligible' => $nextEdgeEligibility,
                'tls_ready_at' => $nextEdgeEligibility || $withinActiveGrace ? $domain->tls_ready_at : null,
                'updated_at' => $now,
            ];
            // Auto-TLS: a person asked for this check and it just proved BOTH
            // ownership and routing, so provisioning the certificate is the
            // natural next step and must not need a second click. The periodic
            // sweep (`requestedBy` null) never starts ACME on its own, a domain
            // that was explicitly disabled stays disabled, and a domain already
            // holding a live certificate is left alone.
            $autoTlsVersion = null;
            if ($found && $nextState === 'verified' && $this->requestedBy !== null
                && $this->previousState !== 'disabled' && $domain->tls_ready_at === null) {
                $autoTlsVersion = (int) $domain->tls_version + 1;
                $nextState = 'provisioning';
                $updates['state'] = 'provisioning';
                $updates['edge_eligible'] = true;
                $updates['tls_version'] = $autoTlsVersion;
                $updates['tls_ready_at'] = null;
                $updates['tls_error'] = null;
            }
            $domain->update($updates);
            if ($found && in_array($this->previousState, ['pending', 'error'], true)) {
                WebhookService::dispatch($this->workspaceId, 'domain.verified', [
                    'domainId' => $this->domainId,
                    'domain' => $this->domain,
                ]);
            }

            return [
                'found' => $found,
                'state' => $nextState,
                'dnsError' => $found ? null : $dns['error'],
                'failureCount' => $failureCount,
                'withinGrace' => $withinActiveGrace,
                'firstVerification' => in_array($this->previousState, ['pending', 'error'], true),
                'autoTlsVersion' => $autoTlsVersion,
            ];
        });
        if (! $result) {
            $this->releaseDedupeLock();

            return;
        }

        OperationalMetrics::increment($result['found'] ? 'dns.verified' : 'dns.failed');

        if ($result['autoTlsVersion'] !== null) {
            $this->startAutoTls((int) $result['autoTlsVersion']);
        }

        try {
            try {
                Audit::write(
                    $this->requestedBy,
                    $result['firstVerification'] ? 'domain.verify' : 'domain.revalidate',
                    'domain',
                    $this->domainId,
                    [
                        'found' => $result['found'],
                        'state' => $result['state'],
                        'dns_error' => $result['dnsError'],
                        'failure_count' => $result['failureCount'],
                        'within_grace' => $result['withinGrace'],
                    ],
                    workspaceId: $this->workspaceId,
                );
            } catch (Throwable $e) {
                report($e);
            }
        } catch (Throwable $e) {
            // DNS state is authoritative. Auxiliary notifications must never
            // turn a completed verification into a misleading failed job.
            report($e);
        } finally {
            $this->releaseDedupeLock();
        }
    }

    public function failed(?Throwable $exception): void
    {
        $initialVerification = in_array($this->previousState, ['pending', 'error'], true);
        $updates = [
            'dns_check_completed_at' => now(),
            'dns_error' => 'resolver_unavailable',
            'updated_at' => now(),
        ];
        if ($initialVerification) {
            $updates['state'] = 'error';
            $updates['verified_at'] = null;
            $updates['edge_eligible'] = false;
        }
        $updated = CustomDomain::where('id', $this->domainId)->where('workspace_id', $this->workspaceId)
            ->where('verification_version', $this->verificationVersion)
            ->when(
                $initialVerification,
                fn ($query) => $query->where('state', 'verifying'),
                fn ($query) => $query->where('state', $this->previousState),
            )
            ->update($updates);
        $this->releaseDedupeLock();
        if ($updated > 0) {
            OperationalMetrics::increment('dns.failed');
            try {
                Audit::write($this->requestedBy, 'domain.verification_failed', 'domain', $this->domainId, [
                    'exception' => $exception ? $exception::class : null,
                ], workspaceId: $this->workspaceId);
            } catch (Throwable $e) {
                report($e);
            }
        }
    }

    /** @return array{ownership: bool, routing: bool, error: ?string} */
    private function checkDns(): array
    {
        $ownership = $this->checkTxt();
        $routing = $this->checkCname();
        $error = match (true) {
            ! $ownership && ! $routing => 'ownership_and_routing_missing',
            ! $ownership => 'ownership_missing',
            ! $routing => 'routing_missing',
            default => null,
        };

        return ['ownership' => $ownership, 'routing' => $routing, 'error' => $error];
    }

    private function checkTxt(): bool
    {
        // A TXT record cannot coexist with a CNAME at the same owner name.
        // New integrations therefore use a dedicated TXT label. The bare
        // hostname remains as a temporary compatibility fallback for domains
        // created before this convention was introduced.
        $resolverFailed = false;
        foreach (['_uvh-verification.'.$this->domain, $this->domain] as $name) {
            $records = dns_get_record($name, DNS_TXT);
            if ($records === false) {
                $resolverFailed = true;

                continue;
            }
            foreach ($records as $record) {
                $txt = $this->txtValue($record);
                // Case-insensitive on purpose: the token is copied into a DNS
                // panel by a person and some providers normalise the case of a
                // TXT value. Comparing byte by byte made activation depend on a
                // detail the operator cannot see, and a failed comparison here
                // is reported as absent ownership, not as a case mismatch.
                // The CNAME check below compares provider data the same way.
                if ($txt !== '' && hash_equals(strtolower($this->verificationToken), strtolower($txt))) {
                    return true;
                }
            }
        }
        if ($resolverFailed) {
            // Resolver failure is not evidence that ownership disappeared.
            throw new \RuntimeException('No se pudo consultar DNS');
        }

        return false;
    }

    private function checkCname(): bool
    {
        $expected = strtolower(trim((string) config('uvh.custom_domains.cname_target'), '.'));
        if ($expected === '') {
            // Local development remains usable without a production edge.
            return ! app()->environment('production');
        }

        $records = dns_get_record($this->domain, DNS_CNAME);
        if ($records === false) {
            throw new \RuntimeException('No se pudo consultar la ruta DNS');
        }
        foreach ($records as $record) {
            $target = $record['target'] ?? null;
            if (is_string($target) && hash_equals($expected, strtolower(rtrim($target, '.')))) {
                return true;
            }
        }

        return false;
    }

    /** @param array<string, mixed> $record */
    private function txtValue(array $record): string
    {
        $value = $record['txt'] ?? '';
        if (is_string($value) && $value !== '') {
            return trim($value, "\" \t\r\n");
        }

        $entries = $record['entries'] ?? null;
        if (! is_array($entries)) {
            return '';
        }

        $parts = array_filter($entries, static fn ($part) => is_string($part));

        return trim(implode('', $parts), "\" \t\r\n");
    }

    /**
     * Kick TLS provisioning for the verification that just proved ownership and
     * routing. Same contract as the manual activation: a queue outage must not
     * leave the domain parked in `provisioning` with no worker coming.
     */
    private function startAutoTls(int $tlsVersion): void
    {
        if ($this->requestedBy === null) {
            return;
        }
        try {
            ProvisionDomainTlsJob::dispatch(
                $this->domainId,
                $this->workspaceId,
                $this->requestedBy,
                $this->domain,
                $tlsVersion,
            );
        } catch (Throwable $e) {
            CustomDomain::where('id', $this->domainId)->where('workspace_id', $this->workspaceId)
                ->where('state', 'provisioning')->where('tls_version', $tlsVersion)
                ->update(['state' => 'verified', 'edge_eligible' => false, 'tls_error' => 'queue_unavailable', 'updated_at' => now()]);
            report($e);

            return;
        }

        try {
            Audit::write($this->requestedBy, 'domain.tls_requested', 'domain', $this->domainId, [
                'auto' => true,
            ], workspaceId: $this->workspaceId);
        } catch (Throwable $e) {
            report($e);
        }
    }

    private function releaseDedupeLock(): void
    {
        try {
            Cache::restoreLock($this->dedupeKey, $this->dedupeOwner)->release();
        } catch (Throwable $e) {
            report($e);
        }
    }
}
