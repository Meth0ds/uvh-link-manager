<?php

namespace App\Support;

/**
 * Cifrado at-rest con clave derivada por HMAC y separación de dominio.
 *
 * APP_SECRET es siempre la clave de escritura. APP_SECRET_PREVIOUS forma un
 * keyring acotado de sólo lectura durante rotaciones; permite desplegar la
 * nueva clave, recifrar de forma reanudable y retirar después las antiguas sin
 * pérdida de datos ni un corte brusco de tokens firmados en vuelo.
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

        $appKey = (string) config('app.key');
        if ($appKey === '') {
            throw new \RuntimeException('APP_KEY es obligatorio para cifrar datos');
        }

        return hash('sha256', $appKey);
    }

    /** @return non-empty-list<string> */
    public static function secrets(): array
    {
        $current = self::secret();
        $configured = config('uvh.secret_previous', []);
        if (! is_array($configured)) {
            $configured = [];
        }

        $secrets = [$current];
        foreach ($configured as $candidate) {
            if (! is_string($candidate) || $candidate === '' || in_array($candidate, $secrets, true)) {
                continue;
            }
            $secrets[] = $candidate;
        }

        return $secrets;
    }

    public static function atRestKey(): string
    {
        return self::atRestKeyFor(self::secret());
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
        if (strlen($buf) < 28) {
            throw new \RuntimeException('At-rest ciphertext is malformed');
        }
        $iv = substr($buf, 0, 12);
        $tag = substr($buf, 12, 16);
        $enc = substr($buf, 28);

        foreach (self::secrets() as $secret) {
            $plain = openssl_decrypt(
                $enc,
                'aes-256-gcm',
                self::atRestKeyFor($secret),
                OPENSSL_RAW_DATA,
                $iv,
                $tag,
            );
            if ($plain !== false) {
                return $plain;
            }
        }

        throw new \RuntimeException('At-rest decryption failed');
    }

    public static function encryptedWithCurrentKey(string $value): bool
    {
        if (! str_starts_with($value, self::PREFIX)) {
            return false;
        }

        $buf = Ids::base64urlDecode(substr($value, strlen(self::PREFIX)));
        if (strlen($buf) < 28) {
            return false;
        }

        return openssl_decrypt(
            substr($buf, 28),
            'aes-256-gcm',
            self::atRestKey(),
            OPENSSL_RAW_DATA,
            substr($buf, 0, 12),
            substr($buf, 12, 16),
        ) !== false;
    }

    public static function hashIp(string $ip): string
    {
        return substr(hash_hmac('sha256', 'ip:'.$ip, self::secret()), 0, 32);
    }

    /** Daily keyed pseudonym: uncorrelatable across days or deployments. */
    public static function visitorHash(string $day, string $ip, string $userAgent): string
    {
        return hash_hmac('sha256', 'visitor:'.$day.'|'.$ip.'|'.$userAgent, self::secret());
    }

    private static function atRestKeyFor(string $secret): string
    {
        return hash_hmac('sha256', 'uvh:at-rest:v1', $secret, true);
    }
}
