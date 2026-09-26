<?php

namespace App\Support;

/**
 * Cifrado autenticado de afirmaciones opacas (AES-256-GCM) con key-id.
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
 *    autenticación va dentro del cifrado: un bit alterado invalida la tag y
 *    `open()` devuelve null, sin distinguir «tag mala» de «clave equivocada»
 *    de «basura bien formada».
 *  - **Key-id dentro del sello, cubierto por la tag.** Cada clave del keyring
 *    tiene una etiqueta pública derivada de ella misma (`UvhCrypto::keyId`) y
 *    el sello la lleva en sus primeros bytes, además de meterla en los datos
 *    asociados (AAD) de GCM. Así `open()` nombra directamente la clave que
 *    selló el blob —una búsqueda por clave, no un ensayo por clave del
 *    keyring—, y un key-id alterado para apuntar a otra clave real del keyring
 *    falla la tag: la etiqueta viaja con el sello, pero sólo el sello la
 *    respalda. Lo que un observador aprende del key-id es qué clave del
 *    despliegue selló el blob; no la afirmación, ni su edad, ni la rama que la
 *    emitió. Un señuelo lleva la misma etiqueta que un secreto real.
 *  - **Clave derivada por HKDF con dominio propio.** `UvhCrypto` ya deriva
 *    claves por dominio (`at-rest`); este sello tiene el suyo para que un
 *    texto cifrado en un contexto no sea legible en otro.
 *  - **Keyring completo en apertura, como `SignedToken`.** `APP_SECRET`
 *    escribe; `APP_SECRET_PREVIOUS` abre durante la ventana de rotación que
 *    `APP_SECRET_ROTATION_UNTIL` acota, de modo que un despliegue nuevo no
 *    corta los sellos en vuelo. Retirar una clave vieja cierra sus sellos:
 *    por eso la ventana debe durar más que el TTL más largo de los sellos
 *    (24h del secreto de edición, 7d de un aparcadero) antes de retirarla.
 *  - **Retrocompatibilidad con el formato sin key-id.** Un blob anterior no
 *    lleva etiqueta: si sus primeros bytes no nombran ninguna clave viva —o
 *    la nombran y la tag falla—, `open()` reintenta con el formato antiguo
 *    probando el keyring completo. Es el camino de transición del despliegue:
 *    los sellos viejos mueren por su propia expiración y este ramal puede
 *    retirarse después.
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

    /** Longitud del key-id dentro del buffer: los 6 caracteres base64url de 4 bytes derivados. */
    private const KEY_ID_LENGTH = 6;

    /** Este verificador corre sobre una cookie controlada por el atacante. */
    private const MAX_TOKEN_BYTES = 4096;

    public static function seal(string $plaintext): string
    {
        $secret = UvhCrypto::secret();
        $keyId = UvhCrypto::keyId($secret);
        $nonce = random_bytes(self::NONCE_BYTES);
        $tag = '';
        $cipher = openssl_encrypt(
            $plaintext,
            'aes-256-gcm',
            self::key($secret),
            OPENSSL_RAW_DATA,
            $nonce,
            $tag,
            $keyId,
            self::TAG_BYTES,
        );
        if ($cipher === false) {
            throw new \RuntimeException('Sealed token encryption failed');
        }

        SealFormatTelemetry::modernIssued();

        return Ids::base64urlEncode($keyId.$nonce.$tag.$cipher);
    }

    /**
     * Abre un sello, o devuelve null ante cualquier forma de estar mal.
     *
     * Vacío, demasiado largo, alfabeto ajeno a base64url, truncado, bit
     * alterado, otra clave u otro despliegue: todo es el mismo null, para que
     * ni el llamante ni su observador aprendan cuál fue.
     *
     * `$legacy` dice cómo se abrió —true si fue el formato sin key-id, false
     * si el moderno, null si no se abrió nada— para que el consumidor registre
     * la evidencia de formato DESPUÉS de su validación semántica (patrón,
     * expiración…). Registrar aquí contaría como «vivo» un sello auténtico que
     * ya caducó y no autoriza nada; la ventana de retirada del fallback se mide
     * con los que siguen sirviendo, no con los que meramente descifran.
     */
    public static function open(string $token, ?bool &$legacy = null): ?string
    {
        $legacy = null;
        if ($token === '' || strlen($token) > self::MAX_TOKEN_BYTES || preg_match('/^[A-Za-z0-9_-]+$/D', $token) !== 1) {
            return null;
        }

        $buffer = Ids::base64urlDecode($token);
        if (strlen($buffer) < self::NONCE_BYTES + self::TAG_BYTES + 1) {
            return null;
        }

        // Formato actual primero; si su key-id no nombra nada o la tag no
        // respalda lo que nombra, queda el formato sin etiqueta de antes.
        $plain = self::openSealed($buffer);
        if ($plain !== null) {
            $legacy = false;

            return $plain;
        }
        $plain = self::openLegacy($buffer);
        if ($plain !== null) {
            $legacy = true;
        }

        return $plain;
    }

    /** Formato v2: `keyId | nonce | tag | cipher`, con el key-id como AAD. */
    private static function openSealed(string $buffer): ?string
    {
        if (strlen($buffer) < self::KEY_ID_LENGTH + self::NONCE_BYTES + self::TAG_BYTES + 1) {
            return null;
        }
        $keyId = substr($buffer, 0, self::KEY_ID_LENGTH);
        $secret = UvhCrypto::secretByKeyId($keyId);
        if ($secret === null) {
            return null;
        }
        $plain = openssl_decrypt(
            substr($buffer, self::KEY_ID_LENGTH + self::NONCE_BYTES + self::TAG_BYTES),
            'aes-256-gcm',
            self::key($secret),
            OPENSSL_RAW_DATA,
            substr($buffer, self::KEY_ID_LENGTH, self::NONCE_BYTES),
            substr($buffer, self::KEY_ID_LENGTH + self::NONCE_BYTES, self::TAG_BYTES),
            $keyId,
        );

        return $plain === false ? null : $plain;
    }

    /**
     * Formato sin key-id (`nonce | tag | cipher`), probando el keyring completo
     * sin salida temprana al acertar: la clave que abre no debe ser observable
     * por cronometraje (mismo criterio que `SignedToken::verify`). Se recorre
     * entero aunque una clave ya haya abierto, y se devuelve el primer texto
     * plano que abrió.
     */
    private static function openLegacy(string $buffer): ?string
    {
        $nonce = substr($buffer, 0, self::NONCE_BYTES);
        $tag = substr($buffer, self::NONCE_BYTES, self::TAG_BYTES);
        $cipher = substr($buffer, self::NONCE_BYTES + self::TAG_BYTES);

        $plain = null;
        foreach (UvhCrypto::secrets() as $secret) {
            $opened = openssl_decrypt($cipher, 'aes-256-gcm', self::key($secret), OPENSSL_RAW_DATA, $nonce, $tag);
            if ($opened !== false && $plain === null) {
                $plain = $opened;
            }
        }

        return $plain;
    }

    private static function key(string $secret): string
    {
        return hash_hkdf('sha256', $secret, 32, 'uvh:sealed-token:v1');
    }
}
