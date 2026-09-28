<?php

namespace App\Support;

/**
 * Which hostnames may become a custom domain at all.
 *
 * The product supports a subdomain with a direct CNAME; nothing else. The UI
 * says so, and this is where the server agrees with it: no IP literals, no
 * special-use or infrastructure names, no apex domains (they need flattening
 * or ALIAS records the platform does not control), and never a name under
 * UVH's own infrastructure.
 *
 * Pure on purpose: `rejectReason()` takes the environment's strictness as a
 * argument so the rules can be tested without faking the application
 * environment. Special-use names (`*.test`, `*.example`, …) are only refused
 * in strict mode, because local development and the DNS fixture legitimately
 * live under `.test`.
 */
final class DomainAdmission
{
    /** Reserved TLDs that can never host production traffic (RFC 6761/2606). */
    private const SPECIAL_USE_TLDS = [
        'localhost', 'local', 'localdomain', 'test', 'invalid', 'example', 'alt', 'onion', 'arpa',
    ];

    /**
     * @param  list<string>  $firstPartyHosts  UVH's own names (public, app, edge targets)
     * @return ?string null when the hostname is acceptable, else the reason key
     */
    public static function rejectReason(string $domain, bool $strict, array $firstPartyHosts = []): ?string
    {
        if ($domain === '' || ! str_contains($domain, '.')) {
            return 'invalid';
        }
        if (filter_var($domain, FILTER_VALIDATE_IP) !== false) {
            return 'ip_literal';
        }

        $labels = explode('.', $domain);
        $tld = (string) end($labels);
        if ($strict && in_array($tld, self::SPECIAL_USE_TLDS, true)) {
            return 'special_use';
        }

        // The registrable unit is one label above the public suffix. The
        // curated suffix subset knows the multi-label cases (`co.uk`,
        // `github.io`, …); anything unlisted is assumed to be a single-label
        // TLD, which is the ordinary case.
        $suffixLabels = PublicSuffixes::suffixLabels($domain);
        if ($suffixLabels === 0) {
            $suffixLabels = 1;
        }
        if (count($labels) - $suffixLabels < 2) {
            // The apex itself, or the public suffix: both need DNS features
            // (flattening, ALIAS) the CNAME-only integration does not use.
            return 'apex';
        }

        foreach ($firstPartyHosts as $host) {
            $host = strtolower(trim($host, '.'));
            if ($host === '') {
                continue;
            }
            // Any name *under* the platform's infrastructure, not just the
            // exact hosts: `api.app.uvh.es` must not become a custom domain.
            if ($domain === $host || str_ends_with($domain, '.'.$host)) {
                return 'first_party';
            }
        }

        return null;
    }
}
