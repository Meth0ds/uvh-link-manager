<?php

namespace App\Support;

use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;

/**
 * The facts the platform needs from a peer certificate: when it expires and
 * who issued it. Everything else about the handshake is cURL's business.
 *
 * Pure on purpose: `CURLINFO_CERTINFO` is just an array of strings, so the
 * parsing (and its edge cases — missing fields, unparseable dates, the
 * `CN = R3` style distinguished names) is unit-testable without a socket.
 */
final class TlsCertInfo
{
    /**
     * @param  array<string, mixed>  $entry  One `CURLINFO_CERTINFO` element
     * @return array{notAfter: CarbonInterface, issuer: ?string}|null
     */
    public static function fromCertInfoEntry(array $entry): ?array
    {
        $expire = $entry['Expire date'] ?? $entry['Expire Date'] ?? null;
        if (! is_string($expire) || $expire === '') {
            return null;
        }
        $timestamp = strtotime($expire);
        if ($timestamp === false) {
            return null;
        }

        return [
            'notAfter' => Carbon::createFromTimestamp($timestamp),
            'issuer' => self::commonName($entry['Issuer'] ?? null),
        ];
    }

    /**
     * @param  array<int, mixed>|null  $certInfo  `curl_getinfo($ch, CURLINFO_CERTINFO)`
     * @return array{notAfter: CarbonInterface, issuer: ?string}|null
     */
    public static function fromCurlCertInfo(?array $certInfo): ?array
    {
        if (! is_array($certInfo)) {
            return null;
        }
        // The first entry is the leaf certificate — the one that must be valid
        // for the visitor's hostname. Anything after it is the chain.
        foreach ($certInfo as $entry) {
            if (is_array($entry)) {
                $parsed = self::fromCertInfoEntry($entry);
                if ($parsed !== null) {
                    return $parsed;
                }
            }
        }

        return null;
    }

    /**
     * Pull the CN out of a distinguished name line like
     * `C = US, O = Let's Encrypt, CN = R3`. Returns the raw value when no CN
     * is present rather than inventing one.
     */
    public static function commonName(mixed $distinguishedName): ?string
    {
        if (! is_string($distinguishedName) || $distinguishedName === '') {
            return null;
        }
        if (preg_match('/(?:^|,\s*)CN\s*=\s*([^,]+)/i', $distinguishedName, $matches) === 1) {
            return trim($matches[1]);
        }

        return trim($distinguishedName);
    }
}
