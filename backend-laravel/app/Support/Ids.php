<?php

namespace App\Support;

class Ids
{
    public const ALIAS_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

    public static function randomToken(int $bytes = 32): string
    {
        return self::base64urlEncode(random_bytes($bytes));
    }

    public static function sha256Hex(string $input): string
    {
        return hash('sha256', $input);
    }

    public static function randomCode(): string
    {
        return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    }

    public static function randomAlias(int $length = 8): string
    {
        $out = '';
        $alphabet = self::ALIAS_ALPHABET;
        $max = strlen($alphabet) - 1;
        for ($i = 0; $i < $length; $i++) {
            $out .= $alphabet[random_int(0, $max)];
        }

        return $out;
    }

    public static function base64urlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    public static function base64urlDecode(string $data): string
    {
        // Strict decoding prevents malformed bearer cookies/tokens from
        // reaching json_decode/openssl as a PHP warning or a type error.
        $normalized = strtr($data, '-_', '+/');
        $padding = strlen($normalized) % 4;
        if ($padding !== 0) {
            $normalized .= str_repeat('=', 4 - $padding);
        }
        $decoded = base64_decode($normalized, true);

        return $decoded === false ? '' : $decoded;
    }
}
