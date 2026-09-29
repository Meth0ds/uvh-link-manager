<?php

namespace App\Jobs;

use App\Models\CustomDomain;
use App\Support\Audit;
use App\Support\DomainClaims;
use App\Support\DomainEvents;
use App\Support\DomainStatus;
use App\Support\OperationalMetrics;
use App\Support\WorkspaceAccess;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * One DNS verification attempt for a custom domain.
 *
 * The job applies its result to the four status columns — ownership, routing,
 * TLS and intent — and records domain events in the same transaction, so the
 * state a human sees and the history that explains it are one fact. Three
 * rules shape the writes:
 *
 *  - The result is only applied while the generation still matches: a newer
 *    check or a cancellation bumped `verification_version` and this answer is
 *    stale by definition.
 *  - Ownership is proven by the TXT challenge *and* the claim: publishing the
 *    token claims the hostname atomically, and a fresh claim held by another
 *    workspace is reported as `domain_claimed_elsewhere` rather than stolen.
 *  - Authorization is re-checked at execution, not only at admission: the
 *    actor's membership, security version and API token scope are carried here
 *    and revalidated before anything is written. A revoked credential cancels
 *    the operation cleanly instead of completing it.
 */
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
        public ?int $actorSecurityVersion,
        public ?int $apiTokenId,
        public string $domain,
        public string $verificationToken,
        public int $verificationScheme,
        public int $verificationVersion,
        public string $dedupeKey,
        public string $dedupeOwner,
    ) {
        $this->onQueue('domains');
    }

    public function handle(): void
    {
        $dns = $this->checkDns();
        $eventIds = [];
        $result = DB::transaction(function () use ($dns, &$eventIds): ?array {
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
            // Canonical lock order: auth (above), then the hostname's claim
            // lock, then domain rows. Taking the hostname lock before any row
            // of that hostname is what makes a concurrent takeover serialize
            // instead of deadlocking on the claim/row inversion.
            DomainClaims::lockHostname($this->domain);
            $domain = CustomDomain::where('id', $this->domainId)
                ->where('workspace_id', $this->workspaceId)->lockForUpdate()->first();
            if (! $domain || $domain->domain !== $this->domain || $domain->verification_token !== $this->verificationToken) {
                return null;
            }
            if ((int) $domain->verification_version !== $this->verificationVersion) {
                // A newer check or a cancellation owns this domain now.
                return null;
            }
            if (! $authorized) {
                $domain->update(DomainStatus::cancelDnsCheck($domain, 'verification_cancelled'));

                return null;
            }

            $now = now();
            $wasServing = DomainStatus::servingReady($domain);
            $firstVerification = $domain->verified_at === null;
            $previouslyDegraded = $domain->dns_error !== null;

            // Ownership: the TXT proves control of the name and claims it. A
            // fresh claim held elsewhere means this workspace may keep its
            // request but the hostname belongs to someone else today.
            $ownershipProven = $dns['ownership'];
            $claimOutcome = null;
            $previousWorkspaceId = null;
            $previousDomainIds = [];
            if ($ownershipProven) {
                $claim = DomainClaims::prove($this->workspaceId, $this->domain);
                $claimOutcome = $claim['outcome'];
                $previousWorkspaceId = $claim['previous_workspace_id'];
                $previousDomainIds = $claim['previous_domain_ids'];
            }
            $claimed = $claimOutcome !== 'conflict';
            $routingOk = $dns['routing'];
            $found = $ownershipProven && $claimed && $routingOk;
            $error = match (true) {
                $ownershipProven && ! $claimed => 'domain_claimed_elsewhere',
                ! $ownershipProven && ! $routingOk => 'ownership_and_routing_missing',
                ! $ownershipProven => 'ownership_missing',
                ! $routingOk => 'routing_missing',
                default => null,
            };

            $failureCount = $found ? 0 : (int) $domain->dns_failure_count + 1;
            $firstFailedAt = $found ? null : ($domain->dns_first_failed_at ?? $now);
            $graceHours = max(1, min(24, (int) config('uvh.custom_domains.failure_grace_hours', 2)));
            $maxFailures = max(2, min(10, (int) config('uvh.custom_domains.max_failures', 3)));
            $withinGrace = $wasServing
                && ($failureCount < $maxFailures || $firstFailedAt->gt($now->copy()->subHours($graceHours)));

            // Auto-TLS: the domain wants to serve and DNS now says it can. A
            // first check from a person and an unattended recovery both finish
            // the job; the cooldown keeps a broken CA from being hammered.
            $autoTls = false;
            if ($found && ! $wasServing && $domain->desired_state === 'enabled'
                && $domain->tls_ready_at === null
                && in_array($domain->tls_status, ['pending', 'error'], true)
                && DomainStatus::tlsAutoRetryAllowed($domain)) {
                $autoTls = true;
            }
            $servingAfter = $found
                ? ($wasServing || $autoTls)
                : ($withinGrace && (bool) $domain->edge_eligible);

            $updates = [
                'ownership_status' => $ownershipProven ? 'verified' : ($domain->ownership_verified_at !== null ? 'lost' : 'pending'),
                'ownership_verified_at' => $ownershipProven ? $now : null,
                'routing_status' => $routingOk ? 'healthy' : ($wasServing ? ($withinGrace ? 'degraded' : 'failed') : 'failed'),
                'routing_verified_at' => $routingOk ? $now : null,
                'dns_check_completed_at' => $now,
                'dns_error' => $error,
                'dns_failure_count' => $failureCount,
                'dns_first_failed_at' => $firstFailedAt,
                'verified_at' => $found ? $now : ($withinGrace ? $domain->verified_at : null),
                'edge_eligible' => $servingAfter,
                // What was observed travels with the verdict it produced, so
                // the diagnostic panel can say what the resolver answered.
                'dns_observed_at' => $now,
                'ownership_txt_present' => $dns['ownershipTxtPresent'],
                'routing_observed_target' => $dns['routingObservedTarget'],
                'routing_observed_ttl' => $dns['routingObservedTtl'],
                'routing_observed_addresses' => $dns['routingObservedAddresses'] === [] ? null : $dns['routingObservedAddresses'],
                'routing_observed_proxied' => $dns['routingObservedProxied'],
                'caa_records' => $dns['caaRecords'] === [] ? null : $dns['caaRecords'],
                'caa_allows_issuer' => $dns['caaAllowsIssuer'],
                'updated_at' => $now,
            ];
            $autoTlsVersion = null;
            if ($autoTls) {
                $autoTlsVersion = (int) $domain->tls_version + 1;
                $updates += DomainStatus::beginTlsProvisioning($domain);
                $updates['tls_version'] = $autoTlsVersion;
            }
            $domain->update($updates);

            // History and integrations are recorded with the state they
            // describe; delivery happens after commit and can never decide
            // whether the DNS result stands.
            if ($firstVerification && $found) {
                $eventIds[] = DomainEvents::record($this->workspaceId, $this->domainId, $this->domain, 'domain.verified', [
                    'domainId' => $this->domainId,
                    'domain' => $this->domain,
                ]);
            }
            // The displaced holder hears about the loss as their own fact,
            // recorded against *their* rows: their activity timeline and the
            // notification route must name resources that exist in their
            // workspace, never the new owner's ids. Cross-tenant ids do not
            // travel in the payload either.
            if ($claimOutcome === 'takeover' && $previousWorkspaceId !== null) {
                foreach ($previousDomainIds as $previousDomainId) {
                    $eventIds[] = DomainEvents::record($previousWorkspaceId, $previousDomainId, $this->domain, 'domain.claim_transferred', [
                        'domainId' => $previousDomainId,
                        'domain' => $this->domain,
                        'reason' => 'claim_transferred',
                    ]);
                }
            }
            // The workspace that acquired (or re-acquired) the hostname gets
            // its own fact. Recorded on the transition only — a routine
            // revalidation of a claim that is already yours is not news.
            if ($claimOutcome === 'claimed' || $claimOutcome === 'takeover') {
                $eventIds[] = DomainEvents::record($this->workspaceId, $this->domainId, $this->domain, 'domain.claimed', [
                    'domainId' => $this->domainId,
                    'domain' => $this->domain,
                ]);
            }
            if ($found && $wasServing && $previouslyDegraded) {
                $eventIds[] = DomainEvents::record($this->workspaceId, $this->domainId, $this->domain, 'domain.recovered', [
                    'domainId' => $this->domainId,
                    'domain' => $this->domain,
                ]);
            }
            if (! $found && $wasServing) {
                if ($servingAfter) {
                    $eventIds[] = DomainEvents::record($this->workspaceId, $this->domainId, $this->domain, 'domain.degraded', [
                        'domainId' => $this->domainId,
                        'domain' => $this->domain,
                        'reason' => $error,
                        'failureCount' => $failureCount,
                        'graceExpiresAt' => $firstFailedAt->copy()->addHours($graceHours)->toIso8601String(),
                    ]);
                } else {
                    $eventIds[] = DomainEvents::record($this->workspaceId, $this->domainId, $this->domain, 'domain.offline', [
                        'domainId' => $this->domainId,
                        'domain' => $this->domain,
                        'reason' => $error,
                    ]);
                }
            }

            return [
                'found' => $found,
                'dnsError' => $error,
                'failureCount' => $failureCount,
                'withinGrace' => $withinGrace,
                'firstVerification' => $firstVerification,
                'autoTlsVersion' => $autoTlsVersion,
                'legacyState' => DomainStatus::legacyState($domain),
                'claimOutcome' => $claimOutcome,
            ];
        });
        if ($result === null) {
            DomainEvents::scheduleDispatch($eventIds);
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
                        'state' => $result['legacyState'],
                        'dns_error' => $result['dnsError'],
                        'failure_count' => $result['failureCount'],
                        'within_grace' => $result['withinGrace'],
                        'claim' => $result['claimOutcome'],
                    ],
                    workspaceId: $this->workspaceId,
                );
            } catch (Throwable $e) {
                report($e);
            }
        } finally {
            DomainEvents::scheduleDispatch($eventIds);
            $this->releaseDedupeLock();
        }
    }

    public function failed(?Throwable $exception): void
    {
        $updates = [
            'dns_check_completed_at' => now(),
            'dns_error' => 'resolver_unavailable',
            'updated_at' => now(),
        ];
        $updated = CustomDomain::where('id', $this->domainId)->where('workspace_id', $this->workspaceId)
            ->where('verification_version', $this->verificationVersion)
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

    /**
     * What was asked and what answered, not just the verdict: a user fixing a
     * broken CNAME needs "the resolver returns cname.bitly.com", and a user
     * whose TLS fails needs to know whether CAA blocks the issuer.
     *
     * @return array{
     *   ownership: bool,
     *   ownershipTxtPresent: bool,
     *   routing: bool,
     *   routingObservedTarget: ?string,
     *   routingObservedTtl: ?int,
     *   routingObservedAddresses: list<string>,
     *   routingObservedProxied: ?bool,
     *   caaRecords: list<array{tag: string, value: string}>,
     *   caaAllowsIssuer: ?bool,
     *   error: ?string,
     * }
     */
    private function checkDns(): array
    {
        $ownership = $this->checkTxt();
        $routing = $this->checkCname();
        $caa = $this->checkCaa();

        return [
            'ownership' => $ownership['matched'],
            'ownershipTxtPresent' => $ownership['present'],
            'routing' => $routing['ok'],
            'routingObservedTarget' => $routing['target'],
            'routingObservedTtl' => $routing['ttl'],
            'routingObservedAddresses' => $routing['addresses'],
            'routingObservedProxied' => $routing['proxied'],
            'caaRecords' => $caa['records'],
            'caaAllowsIssuer' => $caa['allowsIssuer'],
            'error' => null,
        ];
    }

    /** @return array{matched: bool, present: bool} */
    private function checkTxt(): array
    {
        // A TXT record cannot coexist with a CNAME at the same owner name, so
        // integrations use a dedicated label. Rows created before that
        // convention carry `verification_scheme = 1` and may still prove
        // ownership at the bare hostname; scheme 2 retires the fallback so it
        // cannot stay "temporary" forever.
        $names = ['_uvh-verification.'.$this->domain];
        if ($this->verificationScheme < 2) {
            $names[] = $this->domain;
        }
        $resolverFailed = false;
        $present = false;
        foreach ($names as $name) {
            // The answer the resolvers agree on (multi-resolver consensus); a
            // disagreement is `false`, the same "no reliable answer" a resolver
            // outage gives, so a poisoned single view can never prove ownership.
            $records = DnsViews::records($name, DNS_TXT);
            if ($records === false) {
                $resolverFailed = true;

                continue;
            }
            foreach ($records as $record) {
                $present = true;
                $txt = $this->txtValue($record);
                // Case-insensitive on purpose: the token is copied into a DNS
                // panel by a person and some providers normalise the case of a
                // TXT value. Comparing byte by byte made activation depend on a
                // detail the operator cannot see, and a failed comparison here
                // is reported as absent ownership, not as a case mismatch.
                // The CNAME check below compares provider data the same way.
                if ($txt !== '' && hash_equals(strtolower($this->verificationToken), strtolower($txt))) {
                    return ['matched' => true, 'present' => true];
                }
            }
        }
        if ($resolverFailed) {
            // Resolver failure is not evidence that ownership disappeared.
            throw new \RuntimeException('No se pudo consultar DNS');
        }

        return ['matched' => false, 'present' => $present];
    }

    /**
     * @return array{
     *   ok: bool,
     *   target: ?string,
     *   ttl: ?int,
     *   addresses: list<string>,
     *   proxied: ?bool,
     * }
     */
    private function checkCname(): array
    {
        $expected = strtolower(trim((string) config('uvh.custom_domains.cname_target'), '.'));
        if ($expected === '') {
            // Local development remains usable without a production edge.
            return [
                'ok' => ! app()->environment('production'),
                'target' => null,
                'ttl' => null,
                'addresses' => [],
                'proxied' => null,
            ];
        }

        $records = DnsViews::records($this->domain, DNS_CNAME);
        if ($records === false) {
            throw new \RuntimeException('No se pudo consultar la ruta DNS');
        }
        $target = null;
        $ttl = null;
        $ok = false;
        foreach ($records as $record) {
            $observed = $record['target'] ?? null;
            if (! is_string($observed) || $observed === '') {
                continue;
            }
            $observed = strtolower(rtrim($observed, '.'));
            $target ??= $observed;
            $ttl ??= isset($record['ttl']) && is_numeric($record['ttl']) ? (int) $record['ttl'] : null;
            if (hash_equals($expected, $observed)) {
                $ok = true;
            }
        }
        if ($target !== null) {
            return [
                'ok' => $ok,
                'target' => $target,
                'ttl' => $ttl,
                'addresses' => [],
                // A CNAME straight to the expected target cannot be a proxy;
                // anything else may be, and the suffixes below certainly are.
                'proxied' => $ok ? false : $this->looksProxied($target),
            ];
        }

        // No CNAME at the hostname. If addresses answer instead, the name is
        // behind a proxy or a flattening setup — precisely the configurations
        // the product does not support and the user must be told about.
        $addresses = $this->lookupAddresses();

        return [
            'ok' => false,
            'target' => null,
            'ttl' => null,
            'addresses' => $addresses,
            'proxied' => $addresses === [] ? null : true,
        ];
    }

    /** @return list<string> */
    private function lookupAddresses(): array
    {
        $addresses = [];
        foreach ([DNS_A, DNS_AAAA] as $type) {
            // An unreachable resolver here is advisory-only: the verdict
            // already came from the CNAME query above. Diagnostics may not
            // hold a state decision hostage to the consensus minimum.
            $records = DnsViews::records($this->domain, $type, 1);
            if ($records === false) {
                continue;
            }
            foreach ($records as $record) {
                $ip = $record['ip'] ?? $record['ipv6'] ?? null;
                if (is_string($ip) && $ip !== '') {
                    $addresses[] = $ip;
                }
            }
        }

        return array_values(array_unique($addresses));
    }

    private function looksProxied(string $target): bool
    {
        foreach ([
            'cloudflare.net', 'edgesuite.net', 'edgekey.net', 'akamai.net',
            'akamaiedge.net', 'fastly.net', 'azureedge.net', 'trafficmanager.net',
            'stackpathdns.com', 'cdngc.net', 'googleusercontent.com',
        ] as $suffix) {
            if ($target === $suffix || str_ends_with($target, '.'.$suffix)) {
                return true;
            }
        }

        return false;
    }

    /**
     * CAA is advisory here: it never decides ownership, it explains a TLS
     * failure. `null` means no CAA restriction was observed, which is the
     * common case and must not be confused with "denied".
     *
     * @return array{records: list<array{tag: string, value: string}>, allowsIssuer: ?bool}
     */
    private function checkCaa(): array
    {
        // CAA is diagnostic: it explains a TLS failure, it never decides
        // ownership or routing, so it does not raise the consensus minimum.
        $records = DnsViews::records($this->domain, DNS_CAA, 1);
        if ($records === false) {
            return ['records' => [], 'allowsIssuer' => null];
        }
        $issuer = strtolower(trim((string) config('uvh.custom_domains.acme_issuer', 'letsencrypt.org'), '.'));
        $observed = [];
        $allows = null;
        foreach ($records as $record) {
            $tag = strtolower((string) ($record['tag'] ?? ''));
            $value = trim((string) ($record['value'] ?? ''));
            if ($tag === '' || $value === '') {
                continue;
            }
            $observed[] = ['tag' => $tag, 'value' => $value];
            // The product has no wildcard hostnames, so only `issue` binds
            // them; `issuewild` alone restricts nothing here.
            if ($tag !== 'issue') {
                continue;
            }
            $property = strtolower(trim(explode(';', $value, 2)[0]));
            if ($property === $issuer) {
                $allows = true;
            } elseif ($allows === null) {
                $allows = false;
            }
        }

        return ['records' => $observed, 'allowsIssuer' => $allows];
    }

    /** @param array<string, mixed> $record */
    private function txtValue(array $record): string
    {
        // Whitespace and the quote style some panels wrap values in — nothing
        // else. An older charlist spelled `\\t` literally and silently ate a
        // trailing `t`, `r` or `n` of the token itself.
        $value = $record['txt'] ?? '';
        if (is_string($value) && $value !== '') {
            return trim($value, " \t\r\n\"");
        }

        $entries = $record['entries'] ?? null;
        if (! is_array($entries)) {
            return '';
        }

        $parts = array_filter($entries, static fn ($part) => is_string($part));

        return trim(implode('', $parts), " \t\r\n\"");
    }

    /**
     * Kick TLS provisioning for the verification that just proved ownership and
     * routing. Same contract as the manual activation: a queue outage must not
     * leave the domain parked in `provisioning` with no worker coming.
     */
    private function startAutoTls(int $tlsVersion): void
    {
        try {
            ProvisionDomainTlsJob::dispatch(
                $this->domainId,
                $this->workspaceId,
                $this->requestedBy,
                $this->actorSecurityVersion,
                $this->apiTokenId,
                $this->domain,
                $tlsVersion,
            );
        } catch (Throwable $e) {
            CustomDomain::where('id', $this->domainId)->where('workspace_id', $this->workspaceId)
                ->where('tls_status', 'provisioning')->where('tls_version', $tlsVersion)
                ->update([
                    'tls_status' => 'error',
                    'edge_eligible' => false,
                    'tls_error' => 'queue_unavailable',
                    'updated_at' => now(),
                ]);
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

    /** @return array{token_id: int}|null */
    private function apiTokenContext(): ?array
    {
        return $this->apiTokenId === null ? null : ['token_id' => $this->apiTokenId];
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
