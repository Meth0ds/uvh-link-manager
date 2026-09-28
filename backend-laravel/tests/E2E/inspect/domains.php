<?php

declare(strict_types=1);

/**
 * Custom domains: the phase the verification worker reached, and the lever
 * that publishes the TLS harness zone.
 *
 * `state` is derived through `DomainStatus::legacyState()` like every other
 * reader of the product, because the column the chain used to read no longer
 * exists: the row now carries the honest statuses and the legacy phase is a
 * projection of them.
 *
 * `domain-dns-serve` writes the authoritative zone for the TLS harness
 * (`tls.uvh`, served by CoreDNS) and reports what the stack's own resolver
 * observes. The scenario polls the observation instead of sleeping: the
 * verification job consults exactly the same resolver, so a record the lever
 * can see is a record the job can see.
 */

use App\Models\CustomDomain;
use App\Support\DomainStatus;

return [
    'domain' => static function (string $argument): array {
        $domain = CustomDomain::find((int) $argument);
        if ($domain === null) {
            return [];
        }

        return [
            'id' => (int) $domain->id,
            'state' => DomainStatus::legacyState($domain),
            'desired_state' => (string) $domain->desired_state,
            'ownership_status' => (string) $domain->ownership_status,
            'routing_status' => (string) $domain->routing_status,
            'tls_status' => (string) $domain->tls_status,
            'tls_error' => $domain->tls_error !== null ? (string) $domain->tls_error : null,
            'edge_eligible' => (bool) $domain->edge_eligible,
            'dns_error' => $domain->dns_error !== null ? (string) $domain->dns_error : null,
            'verified_at' => $domain->verified_at !== null ? (string) $domain->verified_at : null,
            'ownership_verified_at' => $domain->ownership_verified_at !== null ? (string) $domain->ownership_verified_at : null,
            'routing_verified_at' => $domain->routing_verified_at !== null ? (string) $domain->routing_verified_at : null,
            'tls_ready_at' => $domain->tls_ready_at !== null ? (string) $domain->tls_ready_at : null,
            'tls_not_after' => $domain->tls_not_after !== null ? (string) $domain->tls_not_after : null,
            'tls_issuer' => $domain->tls_issuer !== null ? (string) $domain->tls_issuer : null,
        ];
    },
    'domain-dns-serve' => static function (string $argument): array {
        $payload = json_decode($argument, true);
        if (! is_array($payload)) {
            return ['error' => 'domain-dns-serve expects a JSON argument'];
        }
        $domain = strtolower(rtrim((string) ($payload['domain'] ?? ''), '.'));
        $token = (string) ($payload['token'] ?? '');
        $edge = (string) ($payload['edgeAddress'] ?? '');
        if (preg_match('/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/', $domain) !== 1) {
            return ['error' => 'domain-dns-serve: invalid domain'];
        }
        // The full TXT value the product published (`verificationToken` is the
        // record's content, e.g. `uvh-verify=…`), so the whitelist is exactly
        // the character set a token may use inside the quoted zone value.
        if (preg_match('/^[A-Za-z0-9_=-]{8,256}$/', $token) !== 1) {
            return ['error' => 'domain-dns-serve: invalid token'];
        }
        if (filter_var($edge, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
            return ['error' => 'domain-dns-serve: invalid edgeAddress'];
        }

        $file = (string) (getenv('UVH_TLS_ZONE_FILE') ?: '/zones/db.tls.uvh');
        // One complete zone document per call: CoreDNS's `auto` plugin watches
        // the directory and serves the replacement within its reload window.
        // The token and the domain are validated above precisely because both
        // end up inside this document.
        $contents = implode("\n", [
            '$TTL 5',
            '@ IN SOA ns.tls.uvh. hostmaster.tls.uvh. '.time().' 7200 3600 86400 5',
            '@ IN NS ns.tls.uvh.',
            'ns.tls.uvh. IN A 172.31.0.54',
            'edge.tls.uvh. IN A '.$edge,
            $domain.'. IN CNAME edge.tls.uvh.',
            '_uvh-verification.'.$domain.'. IN TXT "'.$token.'"',
            '',
        ]);
        if (@file_put_contents($file, $contents) === false) {
            return ['error' => 'domain-dns-serve: cannot write the zone file'];
        }

        // Observe through the same resolver the product uses (dns-fixture
        // forwarding to CoreDNS), so the scenario waits on fact, not on time.
        // The authority needs its reload window before the zone is live, and
        // in that window the resolver answers SERVFAIL: that is a «not yet»
        // for the polling scenario, never an error to crash on.
        $txt = [];
        foreach (@dns_get_record('_uvh-verification.'.$domain, DNS_TXT) ?: [] as $record) {
            if (isset($record['txt']) && is_string($record['txt'])) {
                $txt[] = $record['txt'];
            }
        }
        $cname = [];
        foreach (@dns_get_record($domain, DNS_CNAME) ?: [] as $record) {
            if (isset($record['target']) && is_string($record['target'])) {
                $cname[] = strtolower(rtrim($record['target'], '.'));
            }
        }
        $addresses = [];
        foreach (@dns_get_record($domain, DNS_A) ?: [] as $record) {
            if (isset($record['ip']) && is_string($record['ip'])) {
                $addresses[] = $record['ip'];
            }
        }

        return [
            'domain' => $domain,
            'observed' => [
                'txt' => $txt,
                'cname' => $cname,
                'addresses' => $addresses,
            ],
        ];
    },
];
