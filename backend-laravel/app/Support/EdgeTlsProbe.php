<?php

namespace App\Support;

use Carbon\CarbonInterface;

/**
 * The one HTTPS probe a custom domain's certificate is ever validated with.
 *
 * It forces SNI = the customer hostname while connecting to the edge IP
 * pinned inside the private network (`CURLOPT_RESOLVE`), with peer and host
 * verification on: what answers is exactly what a visitor would get, from the
 * only network path the platform controls. The hostname is never resolved —
 * that is the SSRF boundary: only an address inside the configured private
 * CIDRs may be contacted, and only on port 443.
 *
 * Shared by the provisioning job (prove the new certificate works) and the
 * periodic probe (prove it still works) so the two can never diverge about
 * what "a working certificate" means.
 */
final class EdgeTlsProbe
{
    /**
     * @return array{status: int, cert: array{notAfter: CarbonInterface, issuer: ?string}|null}
     */
    public static function probe(string $domain): array
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

        $handle = curl_init('https://'.$domain.'/health');
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
            CURLOPT_RESOLVE => [$domain.':443:'.$edgeIp],
            CURLOPT_CERTINFO => true,
            CURLOPT_USERAGENT => 'UVH-TLS-Provisioner/1.0',
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
            CURLOPT_WRITEFUNCTION => static fn ($curl, string $chunk): int => strlen($chunk),
            CURLOPT_HEADERFUNCTION => static fn ($curl, string $header): int => strlen($header),
        ]);

        try {
            $ok = curl_exec($handle);
            if ($ok === false) {
                // A handshake failure is a fact about the certificate, not a
                // crash: callers decide whether it withdraws the domain.
                return ['status' => 0, 'cert' => null];
            }
            $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
            $cert = TlsCertInfo::fromCurlCertInfo(curl_getinfo($handle, CURLINFO_CERTINFO));

            return ['status' => $status, 'cert' => $cert];
        } finally {
            curl_close($handle);
        }
    }
}
