<?php

namespace Tests\Feature;

use App\Support\Ids;
use App\Support\SealedToken;
use App\Support\SealFormatTelemetry;
use App\Support\SignedToken;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Contratos del verificador de formatos: qué evidencia queda cuando un sello
 * legacy abre de verdad, y cuándo el comando certifica la retirada del
 * fallback. La retirada se decide con datos observados, no con memoria.
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

    public function test_only_a_legacy_seal_that_actually_opens_is_recorded(): void
    {
        // `seal()` ya no produce la forma sin key-id; esta se fabrica a mano.
        $this->assertSame('old-claim', SealedToken::open($this->legacySealed('old-claim')));
        SealedToken::open(SealedToken::seal('new-claim'));
        SealedToken::open('basura-que-no-abre');

        $rows = DB::table('audit_events')->where('action', SealFormatTelemetry::ACTION_LEGACY_OPENED)->get();
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
        SealedToken::open($this->legacySealed('old-claim'));
        $this->artisan('uvh:crypto:seals', ['--since' => now()->subDays(40)->toIso8601String()])
            ->assertExitCode(2);
    }

    public function test_the_json_report_names_the_evidence_and_the_keyring(): void
    {
        SealedToken::open($this->legacySealed('old-claim'));
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
