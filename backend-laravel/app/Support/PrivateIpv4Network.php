<?php

namespace App\Support;

/** Strict IPv4 CIDR matching for explicitly configured container networks. */
final class PrivateIpv4Network
{
    /** @param list<string> $cidrs */
    public static function contains(string $ip, array $cidrs): bool
    {
        $candidate = self::ipv4($ip);
        if ($candidate === null) {
            return false;
        }

        foreach ($cidrs as $cidr) {
            $parsed = self::parse($cidr);
            if ($parsed !== null && ($candidate & $parsed['mask']) === $parsed['network']) {
                return true;
            }
        }

        return false;
    }

    /** @param mixed $cidrs */
    public static function validConfiguredCidrs(mixed $cidrs): bool
    {
        if (! is_array($cidrs) || $cidrs === [] || count($cidrs) > 4) {
            return false;
        }

        $seen = [];
        foreach ($cidrs as $cidr) {
            if (! is_string($cidr) || self::parse($cidr) === null) {
                return false;
            }
            $normalized = trim($cidr);
            if (isset($seen[$normalized])) {
                return false;
            }
            $seen[$normalized] = true;
        }

        return true;
    }

    /** @return array{network: int, mask: int}|null */
    private static function parse(string $cidr): ?array
    {
        if (preg_match('/^([^\/]+)\/([0-9]{1,2})$/D', trim($cidr), $match) !== 1) {
            return null;
        }
        $network = self::ipv4($match[1]);
        $prefix = (int) $match[2];
        // A narrow RFC1918 subnet is required. This prevents an internal DNS
        // answer from granting access to unrelated private infrastructure.
        if ($network === null || $prefix < 24 || $prefix > 32) {
            return null;
        }
        $mask = (0xffffffff << (32 - $prefix)) & 0xffffffff;
        if (($network & $mask) !== $network) {
            return null;
        }
        $last = $network | ((~$mask) & 0xffffffff);
        if (! self::insideRfc1918($network) || ! self::insideRfc1918($last)) {
            return null;
        }

        return ['network' => $network, 'mask' => $mask];
    }

    private static function ipv4(string $ip): ?int
    {
        $binary = @inet_pton(trim($ip));
        if ($binary === false || strlen($binary) !== 4) {
            return null;
        }
        $unpacked = unpack('Naddress', $binary);

        return is_array($unpacked) ? (int) $unpacked['address'] : null;
    }

    private static function insideRfc1918(int $ip): bool
    {
        return ($ip >= 0x0a000000 && $ip <= 0x0affffff)
            || ($ip >= 0xac100000 && $ip <= 0xac1fffff)
            || ($ip >= 0xc0a80000 && $ip <= 0xc0a8ffff);
    }
}
