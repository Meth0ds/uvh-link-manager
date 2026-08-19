<?php

namespace App\Support;

/**
 * RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30s step). Implemented locally to
 * avoid an extra dependency.
 */
class Totp
{
    private const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    public static function generateSecret(): string
    {
        // 20 random bytes => 32 base32 chars.
        $bin = random_bytes(20);
        $out = '';
        $buffer = 0;
        $bits = 0;
        for ($i = 0; $i < strlen($bin); $i++) {
            $buffer = ($buffer << 8) | ord($bin[$i]);
            $bits += 8;
            while ($bits >= 5) {
                $bits -= 5;
                $out .= self::BASE32_ALPHABET[($buffer >> $bits) & 0x1f];
            }
        }
        if ($bits > 0) {
            $out .= self::BASE32_ALPHABET[($buffer << (5 - $bits)) & 0x1f];
        }

        return $out;
    }

    public static function verify(string $code, string $secret, int $window = 1): bool
    {
        $key = self::base32Decode($secret);
        $counter = intdiv((int) floor(microtime(true)), 30);
        for ($i = -$window; $i <= $window; $i++) {
            if (hash_equals(self::hotp($key, $counter + $i), $code)) {
                return true;
            }
        }

        return false;
    }

    public static function provisioningUri(string $account, string $issuer, string $secret): string
    {
        $label = $issuer.':'.$account;
        $query = http_build_query([
            'secret' => $secret,
            'issuer' => $issuer,
            'algorithm' => 'SHA1',
            'digits' => 6,
            'period' => 30,
        ]);

        return 'otpauth://totp/'.$label.'?'.$query;
    }

    private static function hotp(string $key, int $counter): string
    {
        $msg = pack('N', 0).pack('N', $counter);
        $hash = hash_hmac('sha1', $msg, $key, true);
        $offset = ord($hash[strlen($hash) - 1]) & 0x0f;
        $bin = ((ord($hash[$offset]) & 0x7f) << 24)
            | (ord($hash[$offset + 1]) << 16)
            | (ord($hash[$offset + 2]) << 8)
            | ord($hash[$offset + 3]);

        return str_pad((string) ($bin % 1000000), 6, '0', STR_PAD_LEFT);
    }

    private static function base32Decode(string $input): string
    {
        $input = strtoupper(rtrim($input, '='));
        $buffer = 0;
        $bits = 0;
        $out = '';
        for ($i = 0; $i < strlen($input); $i++) {
            $idx = strpos(self::BASE32_ALPHABET, $input[$i]);
            if ($idx === false) {
                continue;
            }
            $buffer = ($buffer << 5) | $idx;
            $bits += 5;
            if ($bits >= 8) {
                $bits -= 8;
                $out .= chr(($buffer >> $bits) & 0xff);
            }
        }

        return $out;
    }
}
