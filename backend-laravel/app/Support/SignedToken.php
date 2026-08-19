<?php

namespace App\Support;

class SignedToken
{
    public static function sign(string $payload, int $ttlMs): string
    {
        $exp = (int) (microtime(true) * 1000) + $ttlMs;
        $body = Ids::base64urlEncode($payload);
        $mac = self::mac($body, (string) $exp);

        return "{$body}.{$exp}.{$mac}";
    }

    public static function verify(string $token, ?callable $parse = null): mixed
    {
        // This verifier is used directly on an attacker-controlled cookie.
        // Bound the work and reject malformed segments before decoding them.
        if ($token === '' || strlen($token) > 4096 || ! preg_match('/^[A-Za-z0-9_-]+\\.[0-9]+\\.[A-Za-z0-9_-]+$/', $token)) {
            return null;
        }

        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }

        [$body, $exp, $mac] = $parts;
        $expiresAt = filter_var($exp, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($expiresAt === false || $expiresAt < (int) (microtime(true) * 1000)) {
            return null;
        }

        if (! hash_equals(self::mac($body, $exp), $mac)) {
            return null;
        }

        $payload = Ids::base64urlDecode($body);
        if ($payload === '') {
            return null;
        }
        if ($parse !== null) {
            try {
                return $parse($payload);
            } catch (\Throwable) {
                return null;
            }
        }

        return $payload;
    }

    private static function mac(string $body, string $exp): string
    {
        return Ids::base64urlEncode(hash_hmac('sha256', "{$body}.{$exp}", UvhCrypto::secret(), true));
    }
}
