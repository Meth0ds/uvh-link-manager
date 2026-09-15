<?php

namespace App\Support;

/**
 * An outbound endpoint supplied by configuration.
 *
 * Both external integrations this deployment can be pointed at — the public
 * status feed and the reputation provider — are operator-configured URLs, so
 * both must reject the same shapes before any request is made: local
 * addressing, embedded credentials, non-TLS ports, fragments and raw IPs. The
 * value lives in the environment, but a mistyped or hostile value must not turn
 * into an SSRF probe of the internal network during a secret rotation.
 */
final class ExternalEndpoint
{
    public static function isSafeHttps(string $url): bool
    {
        if ($url === '' || filter_var($url, FILTER_VALIDATE_URL) === false) {
            return false;
        }
        $parts = parse_url($url);
        $host = strtolower(rtrim((string) ($parts['host'] ?? ''), '.'));

        return ($parts['scheme'] ?? null) === 'https' && $host !== ''
            && ! isset($parts['user']) && ! isset($parts['pass']) && ! isset($parts['fragment'])
            && (! isset($parts['port']) || (int) $parts['port'] === 443)
            && filter_var($host, FILTER_VALIDATE_IP) === false
            && $host !== 'localhost' && ! str_ends_with($host, '.localhost')
            && ! str_ends_with($host, '.local') && ! str_ends_with($host, '.internal');
    }

    /** A label safe to store and to publish: the host, never the URL or a token. */
    public static function label(string $url, string $fallback = 'external'): string
    {
        $host = strtolower((string) (parse_url($url, PHP_URL_HOST) ?? ''));
        $host = preg_replace('/[^a-z0-9.-]/', '', $host) ?? '';

        return $host === '' ? $fallback : mb_substr($host, 0, 64);
    }
}
