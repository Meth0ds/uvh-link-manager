<?php

namespace Tests\Feature;

use App\Support\Ids;
use App\Support\SealedToken;
use App\Support\SignedToken;
use App\Support\UvhCrypto;
use Tests\TestCase;

/**
 * Contratos del keyring de sellos: qué nombra el sello, qué sobrevive a una
 * rotación y qué deja de abrirse cuando una clave se retira.
 */
final class SealKeyringTest extends TestCase
{
    private const OLD_SECRET = 'oL7dS2eC9rE4tK8xY1pN6mV3bQ5wA0hJ7uF2iG9zR4cX';

    private const NEW_SECRET = 'nE8wS3eC0rE5tK9xY2pN7mV4bQ6wA1hJ8uF3iG0zR5cX';

    public function test_the_seal_names_its_key_and_the_tag_covers_that_name(): void
    {
        config(['uvh.secret' => self::NEW_SECRET, 'uvh.secret_previous' => []]);

        $signed = SignedToken::sign('claim', 60_000);
        $parts = explode('.', $signed);
        $this->assertCount(4, $parts);
        $this->assertSame(UvhCrypto::keyId(self::NEW_SECRET), $parts[2]);

        $sealed = SealedToken::seal('opaque-claim');
        $keyId = UvhCrypto::keyId(self::NEW_SECRET);
        $this->assertSame($keyId, substr(Ids::base64urlDecode($sealed), 0, strlen($keyId)));
        $this->assertSame('opaque-claim', SealedToken::open($sealed));

        // Renombrar el sello para que apunte a OTRA clave real del keyring no
        // mueve la afirmación de clave: el key-id va cubierto por la tag.
        config(['uvh.secret_previous' => [self::OLD_SECRET]]);
        $moved = $parts;
        $moved[2] = UvhCrypto::keyId(self::OLD_SECRET);
        $this->assertNull(SignedToken::verify(implode('.', $moved)));

        // Un byte alterado en la etiqueta del sello opaco tampoco abre nada,
        // ni como v2 (la etiqueta ya no nombra) ni como formato sin etiqueta.
        $forged = ($sealed[0] === 'A' ? 'B' : 'A').substr($sealed, 1);
        $this->assertNull(SealedToken::open($forged));
    }

    public function test_seals_of_the_previous_key_survive_the_rotation_window_and_die_with_it(): void
    {
        config(['uvh.secret' => self::OLD_SECRET, 'uvh.secret_previous' => []]);
        $oldSigned = SignedToken::sign('signed-before-rotation', 60_000);
        $oldSealed = SealedToken::seal('sealed-before-rotation');

        // Ventana de rotación: la clave anterior sigue abriendo sus sellos
        // mientras la nueva escribe los suyos, cada sello con su propio key-id.
        config(['uvh.secret' => self::NEW_SECRET, 'uvh.secret_previous' => [self::OLD_SECRET]]);
        $this->assertSame('signed-before-rotation', SignedToken::verify($oldSigned));
        $this->assertSame('sealed-before-rotation', SealedToken::open($oldSealed));

        $written = explode('.', SignedToken::sign('signed-during-rotation', 60_000));
        $this->assertSame(UvhCrypto::keyId(self::NEW_SECRET), $written[2]);

        // Retirada la clave anterior, sus sellos dejan de abrirse: la ventana
        // de rotación debe durar más que el TTL más largo de los sellos.
        config(['uvh.secret_previous' => []]);
        $this->assertNull(SignedToken::verify($oldSigned));
        $this->assertNull(SealedToken::open($oldSealed));
        $this->assertSame('signed-during-rotation', SignedToken::verify(implode('.', $written)));
    }

    public function test_the_keyless_formats_issued_before_the_key_id_still_open(): void
    {
        config(['uvh.secret' => self::NEW_SECRET, 'uvh.secret_previous' => []]);

        // Un blob sellado antes del key-id: `nonce | tag | cipher` sin AAD,
        // escrito aquí a mano porque `seal()` ya no produce esa forma.
        $nonce = str_repeat("\x01", 12);
        $tag = '';
        $cipher = openssl_encrypt(
            'old-claim',
            'aes-256-gcm',
            hash_hkdf('sha256', self::NEW_SECRET, 32, 'uvh:sealed-token:v1'),
            OPENSSL_RAW_DATA,
            $nonce,
            $tag,
            '',
            16,
        );
        $this->assertSame('old-claim', SealedToken::open(Ids::base64urlEncode($nonce.$tag.$cipher)));

        // Un token firmado sin segmento de key-id conserva su entrada de MAC
        // original; `sign()` ya no escribe esa forma.
        $exp = (int) (microtime(true) * 1000) + 60_000;
        $body = Ids::base64urlEncode('old-signed');
        $mac = Ids::base64urlEncode(hash_hmac('sha256', "{$body}.{$exp}", self::NEW_SECRET, true));
        $this->assertSame('old-signed', SignedToken::verify("{$body}.{$exp}.{$mac}"));
    }

    public function test_a_key_id_naming_no_live_key_fails_closed(): void
    {
        config(['uvh.secret' => self::NEW_SECRET, 'uvh.secret_previous' => []]);

        $parts = explode('.', SignedToken::sign('claim', 60_000));
        $parts[2] = 'ZZZZZZ';
        $this->assertNull(SignedToken::verify(implode('.', $parts)));

        $this->assertNull(UvhCrypto::secretByKeyId('short'));
        $this->assertNull(UvhCrypto::secretByKeyId('ZZZZZZ'));
        $this->assertNull(SealedToken::open('not-a-seal'));
    }
}
