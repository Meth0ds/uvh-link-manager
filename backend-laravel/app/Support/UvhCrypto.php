<?php

namespace App\Support;

/**
 * Cifrado at-rest con el formato `enc:v1:` (heredado): clave derivada por
 * HMAC del APP_SECRET con separación de dominio.
 */
class UvhCrypto
{
    private const PREFIX = 'enc:v1:';

    public static function secret(): string
    {
        $secret = (string) config('uvh.secret');
        if ($secret !== '') {
            if (strlen($secret) < 32 && app()->environment('production')) {
                throw new \RuntimeException('APP_SECRET debe tener al menos 32 caracteres en producción');
            }

            return $secret;
        }

        // Local/test fallback: derive from APP_KEY so fixtures remain readable
        // within one deployment. Production must never silently fall back to a
        // missing or default secret: that would make signed cookies and
        // encrypted webhook/MFA material forgeable or unrecoverable.
        if (app()->environment('production')) {
            throw new \RuntimeException('APP_SECRET es obligatorio en producción');
        }

        $appKey = (string) env('APP_KEY');
        if ($appKey === '') {
            throw new \RuntimeException('APP_KEY es obligatorio para cifrar datos');
        }

        return hash('sha256', $appKey);
    }

    public static function atRestKey(): string
    {
        return hash_hmac('sha256', 'uvh:at-rest:v1', self::secret(), true);
    }

    public static function encryptAtRest(string $plain): string
    {
        $iv = random_bytes(12);
        $tag = '';
        $enc = openssl_encrypt($plain, 'aes-256-gcm', self::atRestKey(), OPENSSL_RAW_DATA, $iv, $tag, '', 16);
        if ($enc === false) {
            throw new \RuntimeException('At-rest encryption failed');
        }

        return self::PREFIX.Ids::base64urlEncode($iv.$tag.$enc);
    }

    public static function decryptAtRest(string $value): string
    {
        if (! str_starts_with($value, self::PREFIX)) {
            return $value; // legacy plaintext
        }

        $buf = Ids::base64urlDecode(substr($value, strlen(self::PREFIX)));
        $iv = substr($buf, 0, 12);
        $tag = substr($buf, 12, 16);
        $enc = substr($buf, 28);
        $plain = openssl_decrypt($enc, 'aes-256-gcm', self::atRestKey(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($plain === false) {
            throw new \RuntimeException('At-rest decryption failed');
        }

        return $plain;
    }

    public static function hashIp(string $ip): string
    {
        return substr(hash_hmac('sha256', 'ip:'.$ip, self::secret()), 0, 32);
    }
}
