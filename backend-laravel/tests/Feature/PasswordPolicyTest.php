<?php

namespace Tests\Feature;

use App\Models\PendingRegistration;
use App\Models\User;
use App\Support\Ids;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Server-side password weakness enforcement (report finding H-1): the
 * strength meter is client-side only, so the API must reject weak passwords
 * at mailbox activation, reset-password and change-password time.
 */
class PasswordPolicyTest extends TestCase
{
    private const CSRF = 'policy-csrf-token';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, invitations, quotas, pending_registrations, email_tokens, mail_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', self::CSRF)->withHeaders(['X-CSRF-Token' => self::CSRF]);
    }

    private function captchaPayload(): array
    {
        return [
            'website' => '',
            'captchaToken' => 'test-registration-passcode',
            'acceptTerms' => true,
            'termsVersion' => '2026-10-09',
            'privacyVersion' => '2026-10-09',
        ];
    }

    private function activationPayload(string $email, string $name, string $password): array
    {
        $pending = PendingRegistration::create(['email' => $email, 'security_version' => 1]);
        $token = Ids::randomToken(32);
        DB::table('email_tokens')->insert([
            'id' => Ids::sha256Hex($token), 'pending_registration_id' => $pending->id,
            'kind' => 'verify', 'expires_at' => now()->addHour(), 'created_at' => now(),
        ]);

        return array_merge(['token' => $token, 'name' => $name, 'password' => $password], $this->captchaPayload());
    }

    public function test_activation_rejects_common_password_with_weak_error(): void
    {
        $payload = $this->activationPayload('weak@example.com', 'Policy User', 'password-123456');
        $this->postJson('/api/v1/auth/verify-email', $payload)
            ->assertStatus(422)->assertExactJson(['error' => 'La contraseña es demasiado débil']);
        $this->assertDatabaseMissing('users', ['email' => 'weak@example.com']);
        $this->assertDatabaseHas('email_tokens', ['id' => Ids::sha256Hex($payload['token']), 'used_at' => null]);
    }

    public function test_activation_rejects_password_containing_name_or_email(): void
    {
        foreach ([['Alice', 'alice@example.com', 'alice-wonderland-2026'], ['Bob Example', 'bob@example.com', 'bob-example-secure-99']] as [$name, $email, $password]) {
            $this->postJson('/api/v1/auth/verify-email', $this->activationPayload($email, $name, $password))->assertStatus(422);
        }
        $this->assertSame(0, User::count());
    }

    public function test_activation_accepts_strong_passphrase(): void
    {
        $this->postJson('/api/v1/auth/verify-email', $this->activationPayload('strong@example.com', 'Policy User', 'tiovivo-cobrizo-astilla-42'))
            ->assertOk()->assertJson(['ok' => true]);
        $this->assertDatabaseHas('users', ['email' => 'strong@example.com', 'name' => 'Policy User']);
    }

    public function test_reset_password_rejects_weak_password(): void
    {
        $user = User::create([
            'email' => 'reset@example.com',
            'name' => 'Reset User',
            'password_hash' => Hash::make('tiovivo-cobrizo-astilla-42'),
            'email_verified_at' => now(),
        ]);
        $plain = Ids::randomToken(32);
        DB::table('email_tokens')->insert([
            'id' => Ids::sha256Hex($plain),
            'user_id' => $user->id,
            'kind' => 'reset',
            'expires_at' => now()->addHour(),
            'created_at' => now(),
        ]);

        $this->postJson('/api/v1/auth/reset-password', ['token' => $plain, 'password' => 'qwertyuiop123'])
            ->assertStatus(422)
            ->assertExactJson(['error' => 'La contraseña es demasiado débil']);

        // The one-time token must NOT have been consumed by the rejected
        // attempt, so the user can retry with a proper password.
        $this->assertDatabaseHas('email_tokens', ['id' => Ids::sha256Hex($plain), 'used_at' => null]);

        $this->postJson('/api/v1/auth/reset-password', ['token' => $plain, 'password' => 'tiovivo-cobrizo-astilla-42'])
            ->assertStatus(200)
            ->assertExactJson(['ok' => true, 'current' => false]);
    }

    public function test_change_password_rejects_weak_password(): void
    {
        $this->postJson('/api/v1/auth/register', array_merge([
            'name' => 'Charlie',
            'email' => 'charlie@example.com',
            'password' => 'tiovivo-cobrizo-astilla-42',
        ], $this->captchaPayload()))->assertStatus(201);

        $pending = PendingRegistration::where('email', 'charlie@example.com')->firstOrFail();
        $plain = Ids::randomToken(32);
        DB::table('email_tokens')->insert([
            'id' => Ids::sha256Hex($plain),
            'pending_registration_id' => $pending->id,
            'kind' => 'verify',
            'expires_at' => now()->addHour(),
            'created_at' => now(),
        ]);
        $this->postJson('/api/v1/auth/verify-email', [
            'token' => $plain,
            'password' => 'tiovivo-cobrizo-astilla-42',
            'name' => 'Contract User',
            'acceptTerms' => true,
            'termsVersion' => '2026-10-09',
            'privacyVersion' => '2026-10-09',
        ])->assertStatus(200);

        $login = $this->postJson('/api/v1/auth/login', [
            'email' => 'charlie@example.com',
            'password' => 'tiovivo-cobrizo-astilla-42',
            'captchaToken' => 'test-login-passcode',
        ])->assertOk();
        $session = null;
        foreach ($login->headers->getCookies() as $cookie) {
            if ($cookie->getName() === 'uvh_session') {
                $session = $cookie->getValue();
            }
        }
        $this->assertNotNull($session);

        $this->withCookie('uvh_session', $session)
            ->postJson('/api/v1/auth/change-password', [
                'current' => 'tiovivo-cobrizo-astilla-42',
                'newPassword' => 'charlie-brown-1234',
            ])
            ->assertStatus(422)
            ->assertExactJson(['error' => 'La contraseña es demasiado débil']);

        // Old password still works after the rejected change.
        $this->postJson('/api/v1/auth/login', [
            'email' => 'charlie@example.com',
            'password' => 'tiovivo-cobrizo-astilla-42',
            'captchaToken' => 'test-login-passcode',
        ])->assertOk();
    }
}
