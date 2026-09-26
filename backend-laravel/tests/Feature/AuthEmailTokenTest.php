<?php

namespace Tests\Feature;

use App\Jobs\DeliverMailOutboxJob;
use App\Models\PendingRegistration;
use App\Models\User;
use App\Support\Ids;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class AuthEmailTokenTest extends TestCase
{
    private const CSRF = 'email-token-csrf';

    private const CAPTCHA = 'email-token-test-captcha';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, pending_registrations, email_tokens, mail_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', self::CSRF)->withHeaders(['X-CSRF-Token' => self::CSRF]);
        Queue::fake();
    }

    public function test_verification_resend_replaces_old_bearer_and_enforces_account_cooldown(): void
    {
        // Un registro sin verificar vive en `pending_registrations`; su bearer
        // lo nombra a él, nunca a un usuario.
        $pending = PendingRegistration::create([
            'email' => 'verify-cooldown@example.test',
            'security_version' => 1,
        ]);
        DB::table('email_tokens')->insert([
            'id' => str_repeat('a', 64),
            'pending_registration_id' => $pending->id,
            'kind' => 'verify',
            'expires_at' => now()->addDay(),
            'created_at' => now()->subSeconds(61),
        ]);

        // These are unauthenticated anti-enumeration endpoints, so their
        // tests must exercise the same server-verified hCaptcha boundary.
        $this->postJson('/api/v1/auth/resend-verification', [
            'email' => $pending->email,
            'captchaToken' => self::CAPTCHA,
        ])
            ->assertOk()->assertExactJson(['ok' => true]);
        $currentId = DB::table('email_tokens')->where('pending_registration_id', $pending->id)->where('kind', 'verify')->value('id');
        $this->assertNotSame(str_repeat('a', 64), $currentId);
        $this->assertDatabaseCount('email_tokens', 1);

        $this->postJson('/api/v1/auth/resend-verification', [
            'email' => $pending->email,
            'captchaToken' => self::CAPTCHA,
        ])
            ->assertOk()->assertExactJson(['ok' => true]);
        $this->assertSame($currentId, DB::table('email_tokens')->where('pending_registration_id', $pending->id)->value('id'));
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
    }

    public function test_resend_verification_holds_one_uniform_floor_for_known_and_unknown_addresses(): void
    {
        // La compensación temporal: las ramas que contestan `ok` —dirección
        // desconocida, envío real y cooldown— deben durar al menos el mismo
        // suelo, o la latencia vuelve a ser el oráculo de «¿tiene registro
        // pendiente?» que la respuesta genérica viene a cerrar. El suelo se
        // fija bajo el de producción para no alargar la suite; la propiedad es
        // la misma.
        config(['uvh.resend_verification_min_duration_ms' => 150]);

        $pending = PendingRegistration::create([
            'email' => 'uniform-floor@example.test',
            'security_version' => 1,
        ]);

        $timings = [];
        foreach ([
            'unknown' => 'nobody@example.test',
            'send' => $pending->email,
            'cooldown' => $pending->email,
            'unknown again' => 'nobody@example.test',
        ] as $label => $email) {
            $startedAt = hrtime(true);
            $this->postJson('/api/v1/auth/resend-verification', [
                'email' => $email,
                'captchaToken' => self::CAPTCHA,
            ])->assertOk()->assertExactJson(['ok' => true]);
            $timings[$label] = (hrtime(true) - $startedAt) / 1e6;
        }

        foreach ($timings as $label => $milliseconds) {
            $this->assertGreaterThanOrEqual(
                140.0,
                $milliseconds,
                "la rama '{$label}' debía respetar el suelo anti-oráculo y duró {$milliseconds} ms",
            );
        }
    }

    public function test_an_unverified_user_row_is_served_by_the_public_resend(): void
    {
        // Dato heredado o creado a mano: una fila de usuario sin verificar. El
        // login le pide «Verifica tu email» y sin este reenvío no habría forma
        // de cumplir esa frase. Mismo contrato neutro y mismo cooldown que el
        // registro pendiente.
        $user = User::factory()->create([
            'email' => 'legacy-unverified@example.test',
            'email_verified_at' => null,
        ]);

        $this->postJson('/api/v1/auth/resend-verification', [
            'email' => $user->email,
            'captchaToken' => self::CAPTCHA,
        ])->assertOk()->assertExactJson(['ok' => true]);
        $tokenId = DB::table('email_tokens')->where('user_id', $user->id)->where('kind', 'verify')->value('id');
        $this->assertIsString($tokenId);
        $this->assertDatabaseCount('email_tokens', 1);

        // El cooldown de 60 s no emite otro portador ni otro correo.
        $this->postJson('/api/v1/auth/resend-verification', [
            'email' => $user->email,
            'captchaToken' => self::CAPTCHA,
        ])->assertOk()->assertExactJson(['ok' => true]);
        $this->assertSame($tokenId, DB::table('email_tokens')->where('user_id', $user->id)->value('id'));
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);

        // Una cuenta ya verificada no es material de verificación: respuesta
        // neutra igual que una dirección desconocida, sin otro portador.
        User::where('id', $user->id)->update(['email_verified_at' => now()]);
        $this->postJson('/api/v1/auth/resend-verification', [
            'email' => $user->email,
            'captchaToken' => self::CAPTCHA,
        ])->assertOk()->assertExactJson(['ok' => true]);
        $this->assertSame($tokenId, DB::table('email_tokens')->where('user_id', $user->id)->value('id'));
    }

    public function test_the_mailbox_activation_completes_an_unverified_user_row(): void
    {
        // El portador heredado nombra la fila de usuario: quien demuestra el
        // buzón fija aquí la credencial y la cuenta queda verificada, sin
        // crear andamio nuevo ni sustituir la cuenta existente.
        $user = User::factory()->create([
            'email' => 'legacy-activate@example.test',
            'email_verified_at' => null,
            'name' => 'Nombre Anterior',
        ]);
        $securityVersion = (int) $user->security_version;
        $plain = 'verify-'.Ids::randomToken(16);
        DB::table('email_tokens')->insert([
            'id' => Ids::sha256Hex($plain),
            'user_id' => $user->id,
            'kind' => 'verify',
            'expires_at' => now()->addHour(),
            'created_at' => now(),
        ]);
        $activation = [
            'token' => $plain,
            'password' => 'Viento-Verde-42!',
            'name' => 'Nombre Elegido',
            'acceptTerms' => true,
            'termsVersion' => '2026-08-30',
            'privacyVersion' => '2026-08-30',
        ];

        $this->postJson('/api/v1/auth/verify-email', $activation)
            ->assertOk()->assertExactJson(['ok' => true]);

        $user->refresh();
        $this->assertNotNull($user->email_verified_at);
        $this->assertSame('Nombre Elegido', $user->name);
        // La credencial acaba de fijarse: la generación avanza y las sesiones
        // antiguas quedan atrás.
        $this->assertSame($securityVersion + 1, (int) $user->security_version);
        $this->assertNotNull(DB::table('email_tokens')->where('user_id', $user->id)->where('kind', 'verify')->value('used_at'));

        // El portador se consume: repetir la activación no vuelve a abrir nada.
        $this->postJson('/api/v1/auth/verify-email', $activation)->assertStatus(400);
    }

    public function test_password_reset_email_has_an_account_level_cooldown(): void
    {
        $user = User::factory()->create(['email' => 'reset-cooldown@example.test', 'email_verified_at' => now()]);

        $this->postJson('/api/v1/auth/forgot-password', [
            'email' => $user->email,
            'captchaToken' => self::CAPTCHA,
        ])
            ->assertOk()->assertExactJson(['ok' => true]);
        $firstId = DB::table('email_tokens')->where('user_id', $user->id)->where('kind', 'reset')->value('id');
        $this->assertIsString($firstId);

        $this->postJson('/api/v1/auth/forgot-password', [
            'email' => $user->email,
            'captchaToken' => self::CAPTCHA,
        ])
            ->assertOk()->assertExactJson(['ok' => true]);
        $this->assertSame($firstId, DB::table('email_tokens')->where('user_id', $user->id)->value('id'));
        $this->assertDatabaseCount('email_tokens', 1);
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
    }
}
