<?php

namespace Tests\Feature;

use App\Models\PendingRegistration;
use App\Support\Ids;
use App\Support\RegistrationEdit;
use App\Support\SealedToken;
use App\Support\SealFormatTelemetry;
use App\Support\SignedToken;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Contratos del verificador de formatos: qué evidencia queda cuando un sello
 * legacy sigue sirviendo de verdad, y cuándo el comando certifica la retirada
 * del fallback. La retirada se decide con datos observados, no con memoria.
 * La evidencia se emite tras la validación semántica del consumidor, no al
 * descifrar: un sello auténtico caducado no dice que haya nada vivo.
 */
final class SealFormatStatusTest extends TestCase
{
    private const SECRET = 'sT4tUsF0rM4tS3crEtK3yr1nG9xP2wQ6mL8vN1cB5dR7jH';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE audit_events RESTART IDENTITY CASCADE');
        Cache::forget(SealFormatTelemetry::MARKER_CACHE_KEY);
        config(['uvh.secret' => self::SECRET, 'uvh.secret_previous' => []]);
    }

    public function test_only_a_legacy_seal_that_survives_the_consumers_validation_is_recorded(): void
    {
        // `seal()` ya no produce la forma sin key-id; esta se fabrica a mano.
        // Abrir sin más descifra, pero no es evidencia: nada ha validado aún
        // que el claim siga sirviendo.
        $legacy = null;
        $this->assertSame('old-claim', SealedToken::open($this->legacySealed('old-claim'), $legacy));
        $this->assertTrue($legacy, 'the open must report the legacy path to its consumer');
        $this->assertCount(0, $this->legacyOpens());

        // Un sello auténtico caducado descifra igual pero ya no autoriza nada:
        // no puede contar como vivo.
        RegistrationEdit::authorizes(
            $this->requestCarrying($this->legacySealed($this->claim(127, 1, -60_000))),
            $this->pending(127, 1),
        );
        // Formato moderno y basura: tampoco.
        RegistrationEdit::authorizes($this->requestCarrying(SealedToken::seal($this->claim(127, 1))), $this->pending(127, 1));
        $this->assertFalse(RegistrationEdit::authorizes($this->requestCarrying('basura-que-no-abre'), $this->pending(127, 1)));
        $this->assertCount(0, $this->legacyOpens());

        // El claim legacy que además pasa patrón y expiración: exactamente
        // una entrada.
        $this->assertTrue(RegistrationEdit::authorizes(
            $this->requestCarrying($this->legacySealed($this->claim(127, 1))),
            $this->pending(127, 1),
        ));

        $rows = $this->legacyOpens();
        $this->assertCount(1, $rows);
        $this->assertSame('sealed', $rows[0]->resource_id);
    }

    public function test_only_a_legacy_signature_that_verifies_is_recorded(): void
    {
        $this->assertSame('old-signed', SignedToken::verify($this->legacySigned('old-signed')));
        SignedToken::verify(SignedToken::sign('new-signed', 60_000));
        SignedToken::verify('basura.que.no.verifica');

        $rows = DB::table('audit_events')->where('action', SealFormatTelemetry::ACTION_LEGACY_OPENED)->get();
        $this->assertCount(1, $rows);
        $this->assertSame('signed', $rows[0]->resource_id);
    }

    public function test_the_v2_marker_is_written_once_no_matter_how_many_seals_are_issued(): void
    {
        SignedToken::sign('a', 60_000);
        SealedToken::seal('b');
        SignedToken::sign('c', 60_000);
        SealedToken::seal('d');

        $this->assertSame(1, DB::table('audit_events')
            ->where('action', SealFormatTelemetry::ACTION_V2_FIRST_ISSUED)->count());
    }

    public function test_the_command_certifies_a_closed_window_and_refuses_an_open_one(): void
    {
        // Sin marcador v2 ni --since: no hay nada que medir.
        $this->artisan('uvh:crypto:seals')->assertExitCode(1);

        // Cualquier emisión moderna escribe el marcador: la ventana de la huella
        // más reciente (marcador + TTL máximo) queda abierta.
        SealedToken::seal('x');
        $this->artisan('uvh:crypto:seals')->assertExitCode(2);

        // --since antiguo, sin aperturas legacy: ningún sello legacy puede estar
        // vivo, y la retirada se certifica.
        $this->artisan('uvh:crypto:seals', ['--since' => now()->subDays(40)->toIso8601String()])
            ->assertExitCode(0);

        // Una apertura legacy reciente reabre la ventana por sí sola: hay un
        // sello viejo vivo, aunque la emisión legacy terminara hace tiempo.
        $this->recordLegacySealOpen();
        $this->artisan('uvh:crypto:seals', ['--since' => now()->subDays(40)->toIso8601String()])
            ->assertExitCode(2);
    }

    public function test_the_json_report_names_the_evidence_and_the_keyring(): void
    {
        $this->recordLegacySealOpen();
        SealedToken::seal('new-claim');

        // El informe entero se escribe de una vez: se captura la salida y se
        // mira dentro (una expectativa por `expectsOutputToContain` consumiría
        // una escritura cada una, y aquí sólo hay una).
        $exit = Artisan::call('uvh:crypto:seals', ['--since' => now()->subDays(2)->toIso8601String(), '--json' => true]);
        $output = Artisan::output();
        $this->assertSame(2, $exit);
        $this->assertStringContainsString('"verdict": "in_flight"', $output);
        $this->assertStringContainsString('"legacy_opens"', $output);
        $this->assertStringContainsString('"current_key_id"', $output);
    }

    /** Una apertura legacy que supera la validación semántica del consumidor real. */
    private function recordLegacySealOpen(): void
    {
        $this->assertTrue(RegistrationEdit::authorizes(
            $this->requestCarrying($this->legacySealed($this->claim(127, 1))),
            $this->pending(127, 1),
        ));
    }

    /** El claim de edición de registro, con la expiración desplazada en ms. */
    private function claim(int $id, int $securityVersion, int $offsetMs = 60_000): string
    {
        return sprintf(
            '{"e":%013d,"v":2,"pid":"%010d","sv":"%03d"}',
            (int) (microtime(true) * 1000) + $offsetMs,
            $id,
            $securityVersion,
        );
    }

    private function pending(int $id, int $securityVersion): PendingRegistration
    {
        return (new PendingRegistration)->forceFill(['id' => $id, 'security_version' => $securityVersion]);
    }

    private function requestCarrying(string $value): Request
    {
        return Request::create('/', 'GET', [], [RegistrationEdit::cookieName() => $value]);
    }

    /** @return iterable<object> */
    private function legacyOpens(): iterable
    {
        return DB::table('audit_events')->where('action', SealFormatTelemetry::ACTION_LEGACY_OPENED)->get();
    }

    /** Blob sellado sin key-id (`nonce | tag | cipher`, sin AAD), como antes. */
    private function legacySealed(string $plain): string
    {
        $nonce = str_repeat("\x01", 12);
        $tag = '';
        $cipher = openssl_encrypt(
            $plain,
            'aes-256-gcm',
            hash_hkdf('sha256', self::SECRET, 32, 'uvh:sealed-token:v1'),
            OPENSSL_RAW_DATA,
            $nonce,
            $tag,
            '',
            16,
        );

        return Ids::base64urlEncode($nonce.$tag.$cipher);
    }

    /** Token firmado sin segmento de key-id (`body.exp.mac`), como antes. */
    private function legacySigned(string $payload, int $ttlMs = 60_000): string
    {
        $exp = (int) (microtime(true) * 1000) + $ttlMs;
        $body = Ids::base64urlEncode($payload);
        $mac = Ids::base64urlEncode(hash_hmac('sha256', "{$body}.{$exp}", self::SECRET, true));

        return "{$body}.{$exp}.{$mac}";
    }
}
