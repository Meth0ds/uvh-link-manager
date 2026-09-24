<?php

namespace App\Support;

/**
 * Cifrado autenticado de afirmaciones opacas (AES-256-GCM).
 *
 * `SignedToken` firma pero no cifra: su payload lo puede leer cualquiera,
 * lo que sirve cuando la afirmación no tiene secretos que esconder y falla
 * cuando sí los tiene. Este sello es la otra herramienta: el texto plano no
 * sale nunca del servidor y lo que viaja es un blob de longitud fija y
 * distribución uniforme del que no se deduce ni la rama que contestó ni la
 * cuenta que nombra.
 *
 * Decisiones:
 *
 *  - **GCM con nonce aleatorio de 96 bits y tag de 128 bits.** La
 *    autenticación va dentro del cifrado: un bit alterado invalida el tag y
 *    `open()` devuelve null, sin distinguir «mac mala» de «clave equivocada»
 *    de «basura bien formada».
 *  - **Clave derivada por HKDF con dominio propio.** `UvhCrypto` ya deriva
 *    claves por dominio (`at-rest`); este sello tiene el suyo para que un
 *    texto cifrado en un contexto no sea legible en otro.
 *  - **Keyring completo en apertura, como `SignedToken`.** `APP_SECRET_PREVIOUS`
 *    permite rotar sin cortar los sellos en vuelo; se evalúan todas las claves
 *    configuradas sin salir temprano al encontrar la buena.
 *  - **Sin estructura visible.** Ni expiración ni versión ni longitudes fuera
 *    del ciphertext: quienquiera que mire la cookie ve exactamente lo mismo en
 *    un desenlace real y en uno señuelo.
 *
 * La expiración vive dentro del texto plano que cada consumidor sella (p. ej.
 * `RegistrationEdit` la incluye en su claim de ancho fijo), de modo que también
 * queda cubierta por la tag de autenticación.
 */
final class SealedToken
{
    private const NONCE_BYTES = 12;

    private const TAG_BYTES = 16;

    /** Este verificador corre sobre una cookie controlada por el atacante. */
    private const MAX_TOKEN_BYTES = 4096;

    public static function seal(string $plaintext): string
    {
        $nonce = random_bytes(self::NONCE_BYTES);
        $tag = '';
        $cipher = openssl_encrypt(
            $plaintext,
            'aes-256-gcm',
            self::key(UvhCrypto::secret()),
            OPENSSL_RAW_DATA,
            $nonce,
            $tag,
            '',
            self::TAG_BYTES,
        );
        if ($cipher === false) {
            throw new \RuntimeException('Sealed token encryption failed');
        }

        return Ids::base64urlEncode($nonce.$tag.$cipher);
    }

    /**
     * Abre un sello, o devuelve null ante cualquier forma de estar mal.
     *
     * Vacío, demasiado largo, alfabeto ajeno a base64url, truncado, bit
     * alterado, otra clave u otro despliegue: todo es el mismo null, para que
     * ni el llamante ni su observador aprendan cuál fue.
     */
    public static function open(string $token): ?string
    {
        if ($token === '' || strlen($token) > self::MAX_TOKEN_BYTES || preg_match('/^[A-Za-z0-9_-]+$/D', $token) !== 1) {
            return null;
        }

        $buffer = Ids::base64urlDecode($token);
        if (strlen($buffer) < self::NONCE_BYTES + self::TAG_BYTES + 1) {
            return null;
        }
        $nonce = substr($buffer, 0, self::NONCE_BYTES);
        $tag = substr($buffer, self::NONCE_BYTES, self::TAG_BYTES);
        $cipher = substr($buffer, self::NONCE_BYTES + self::TAG_BYTES);

        foreach (UvhCrypto::secrets() as $secret) {
            // Todo el keyring, sin salida temprana al acertar: la clave que
            // abre no debe ser observable por cronometraje (mismo criterio que
            // `SignedToken::verify`).
            $plain = openssl_decrypt($cipher, 'aes-256-gcm', self::key($secret), OPENSSL_RAW_DATA, $nonce, $tag);
            if ($plain !== false) {
                return $plain;
            }
        }

        return null;
    }

    private static function key(string $secret): string
    {
        return hash_hkdf('sha256', $secret, 32, 'uvh:sealed-token:v1');
    }
}
