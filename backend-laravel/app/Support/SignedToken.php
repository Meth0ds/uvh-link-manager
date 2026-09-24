<?php

namespace App\Support;

/**
 * Signed assertions whose seal names the key that signed them.
 *
 * The payload of these tokens is readable by anyone holding the token, which
 * is the point: they carry claims with nothing to hide (a handoff bearer, an
 * unlock context). What the signature guarantees is integrity and expiry, and
 * now also key identity: the token says which key of the keyring signed it,
 * and the MAC covers that name, so a token cannot be moved to another key of
 * the ring and keep its seal.
 *
 * Shape: `body.expiration.keyId.mac`, all base64url-safe. The key-id is the
 * public label `UvhCrypto::keyId` derives from the key itself — knowing which
 * key signed a token is not a secret; the keys are. Three-segment tokens
 * (`body.expiration.mac`, the shape this class used to write) still verify
 * against the whole keyring: they are the migration path for tokens already
 * issued — a seven-day handoff in a cookie, an unlock link in a mailbox — and
 * they die by their own expiry.
 *
 * Rotation is a property of the keyring, not of this class: `APP_SECRET` signs,
 * `APP_SECRET_PREVIOUS` verifies inside the window `APP_SECRET_ROTATION_UNTIL`
 * bounds, and retiring an old key closes exactly the tokens it signed.
 */
class SignedToken
{
    /** Public key label width: the 6 base64url characters of 4 derived bytes. */
    private const KEY_ID_LENGTH = 6;

    public static function sign(string $payload, int $ttlMs): string
    {
        $secret = UvhCrypto::secret();
        $exp = (int) (microtime(true) * 1000) + $ttlMs;
        $keyId = UvhCrypto::keyId($secret);
        $body = Ids::base64urlEncode($payload);
        $mac = self::mac($body, (string) $exp, $keyId, $secret);

        SealFormatTelemetry::modernIssued();

        return "{$body}.{$exp}.{$keyId}.{$mac}";
    }

    public static function verify(string $token, ?callable $parse = null): mixed
    {
        // This verifier is used directly on an attacker-controlled cookie.
        // Bound the work and reject malformed segments before decoding them.
        if ($token === '' || strlen($token) > 4096 || preg_match(
            '/^[A-Za-z0-9_-]+\.[0-9]+\.(?:[A-Za-z0-9_-]{'.self::KEY_ID_LENGTH.'}\.)?[A-Za-z0-9_-]+$/D',
            $token,
        ) !== 1) {
            return null;
        }

        $parts = explode('.', $token);
        $legacy = count($parts) === 3;
        if (! $legacy && count($parts) !== 4) {
            return null;
        }

        [$body, $exp] = $parts;
        $keyId = $legacy ? null : $parts[2];
        $mac = $legacy ? $parts[2] : $parts[3];
        $expiresAt = filter_var($exp, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($expiresAt === false || $expiresAt < (int) (microtime(true) * 1000)) {
            return null;
        }

        if ($legacy) {
            // Pre-key-id shape: no key to name, so evaluate the complete
            // configured keyring. Besides keeping the migration path simple,
            // this avoids making the matching key observable through an
            // avoidable early exit.
            $validMac = false;
            foreach (UvhCrypto::secrets() as $secret) {
                $validMac = hash_equals(self::mac($body, $exp, null, $secret), $mac) || $validMac;
            }
        } else {
            // The key-id is inside the seal: naming another key of the ring
            // changes the MAC input and fails the comparison. Which key signed
            // is public in the token either way, so a direct lookup reveals
            // nothing that the token does not already say.
            $secret = UvhCrypto::secretByKeyId($keyId);
            $validMac = $secret !== null && hash_equals(self::mac($body, $exp, $keyId, $secret), $mac);
        }
        if (! $validMac) {
            return null;
        }
        if ($legacy) {
            // Un token del formato antiguo que verifica de verdad es prueba de
            // que alguno seguía en vuelo: la evidencia que mide la ventana de
            // retirada del fallback. Sólo cuenta el éxito; un rechazo no dice
            // que exista ninguno.
            SealFormatTelemetry::legacyOpened('signed');
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

    /**
     * The MAC covers the body, the expiry and the key-id, so a token cannot
     * rename its key and keep its seal. Legacy tokens —signed before the
     * key-id existed— keep their original MAC input, exactly as issued.
     */
    private static function mac(string $body, string $exp, ?string $keyId, string $secret): string
    {
        $message = $keyId === null ? "{$body}.{$exp}" : "{$body}.{$exp}.{$keyId}";

        return Ids::base64urlEncode(hash_hmac('sha256', $message, $secret, true));
    }
}
