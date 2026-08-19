<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Ids;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Laravel-native parity test: exercises the API contract (shapes, statuses,
 * sensitive-field omission, error envelope) frozen by the original
 * specification. This is the fast in-repo complement to the cross-server
 * runner.
 */
class ApiParityTest extends TestCase
{
    private const CSRF = 'parity-csrf-token';

    private const PASSWORD = 'password-123456';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, invitations, quotas, custom_domains, links, tags, link_tags, redirect_rules, click_events, metric_rollups, api_tokens, webhooks, webhook_deliveries, abuse_reports, audit_events, email_tokens RESTART IDENTITY CASCADE');

        // The app uses raw (unencrypted) cookies: bypass Laravel's test cookie
        // encryption, and send cookies on JSON requests (double-submit CSRF).
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', self::CSRF)->withHeaders(['X-CSRF-Token' => self::CSRF]);
    }

    public function test_register_login_me_and_workspace_contract(): void
    {
        $register = $this->postJson('/api/v1/auth/register', array_merge([
            'name' => 'Contract User',
            'email' => 'parity@example.com',
            'password' => self::PASSWORD,
        ], $this->captchaPayload()));
        $register->assertStatus(201)->assertExactJson(['user' => null]);

        // Anti-enumeration: duplicate registration returns the same shape.
        $this->postJson('/api/v1/auth/register', array_merge([
            'name' => 'Contract User',
            'email' => 'parity@example.com',
            'password' => self::PASSWORD,
        ], $this->captchaPayload()))->assertStatus(201)->assertExactJson(['user' => null]);

        // Registration never creates a session and login is blocked until the
        // email bearer token has been consumed.
        $blocked = $this->postJson('/api/v1/auth/login', [
            'email' => 'parity@example.com',
            'password' => self::PASSWORD,
        ]);
        $blocked->assertStatus(403)->assertExactJson(['error' => 'Verifica tu email para continuar']);
        $this->assertNull($this->cookieFrom($blocked, 'uvh_session'));

        $user = User::where('email', 'parity@example.com')->firstOrFail();
        // Upgrade safety: a session issued by a pre-verification deployment
        // must be revoked during verification, or it could become valid after
        // the account changes to verified.
        $staleToken = Ids::randomToken(32);
        DB::table('sessions')->insert([
            'id' => Ids::sha256Hex($staleToken),
            'user_id' => $user->id,
            'created_at' => now(),
            'last_used_at' => now(),
            'expires_at' => now()->addHour(),
        ]);
        $plain = 'verify-'.Ids::randomToken(16);
        DB::table('email_tokens')->insert([
            'id' => Ids::sha256Hex($plain),
            'user_id' => $user->id,
            'kind' => 'verify',
            'expires_at' => now()->addHour(),
            'created_at' => now(),
        ]);
        $this->postJson('/api/v1/auth/verify-email', ['token' => $plain])
            ->assertStatus(200)->assertJson(['ok' => true]);
        $this->assertNotNull(DB::table('sessions')->where('id', Ids::sha256Hex($staleToken))->value('revoked_at'));
        $this->postJson('/api/v1/auth/verify-email', ['token' => $plain])
            ->assertStatus(400)->assertJson(['error' => 'Token inválido o caducado']);

        $login = $this->postJson('/api/v1/auth/login', [
            'email' => 'parity@example.com',
            'password' => self::PASSWORD,
        ]);
        $login->assertStatus(200)->assertJsonStructure(['user' => [
            'id', 'email', 'name', 'isAdmin', 'emailVerified', 'mfaEnabled',
        ]]);

        $sessionToken = $this->cookieFrom($login, 'uvh_session');
        $this->assertNotNull($sessionToken);

        $me = $this->withCookie('uvh_session', $sessionToken)->getJson('/api/v1/auth/me');
        $me->assertStatus(200);
        $this->assertSame('parity@example.com', $me->json('user.email'));
        $this->assertTrue($me->json('user.emailVerified'));
        $this->expectNoSensitiveFields($me->json());

        $workspaces = $this->withCookie('uvh_session', $sessionToken)->getJson('/api/v1/workspaces');
        $workspaces->assertStatus(200)->assertJsonStructure(['workspaces' => [['id', 'name', 'slug', 'role', 'createdAt']]]);
        $this->assertSame('owner', $workspaces->json('workspaces.0.role'));

        // After verification, the same session can use verified-only APIs.
        $this->withCookie('uvh_session', $sessionToken)
            ->postJson('/api/v1/links', ['destination' => 'https://example.com'])
            ->assertStatus(201)->assertJsonStructure(['link' => ['id', 'shortUrl']]);
    }

    public function test_unverified_registration_can_correct_email_without_a_session(): void
    {
        $oldEmail = 'typo@example.com';
        $newEmail = 'corrected@example.com';
        $this->postJson('/api/v1/auth/register', array_merge([
            'name' => 'Typo User',
            'email' => $oldEmail,
            'password' => self::PASSWORD,
        ], $this->captchaPayload()))->assertStatus(201);

        $changed = $this->postJson('/api/v1/auth/change-registration-email', array_merge([
            'currentEmail' => $oldEmail,
            'newEmail' => $newEmail,
            'password' => self::PASSWORD,
        ], $this->captchaPayload()));
        $changed->assertStatus(200)->assertExactJson(['ok' => true]);
        $this->assertNull($this->cookieFrom($changed, 'uvh_session'));

        $user = User::where('email', $newEmail)->firstOrFail();
        $plain = 'verify-'.Ids::randomToken(16);
        DB::table('email_tokens')->insert([
            'id' => Ids::sha256Hex($plain),
            'user_id' => $user->id,
            'kind' => 'verify',
            'expires_at' => now()->addHour(),
            'created_at' => now(),
        ]);
        $this->postJson('/api/v1/auth/verify-email', ['token' => $plain])->assertStatus(200);
        $login = $this->postJson('/api/v1/auth/login', ['email' => $newEmail, 'password' => self::PASSWORD])->assertStatus(200);
        $this->assertNotNull($this->cookieFrom($login, 'uvh_session'));
    }

    public function test_revoking_current_session_clears_access_immediately(): void
    {
        $sessionToken = $this->registerVerifiedLogin('revoke@example.com');
        $sessions = $this->withCookie('uvh_session', $sessionToken)->getJson('/api/v1/auth/sessions')->assertStatus(200);
        $currentId = $sessions->json('sessions.0.id');
        $this->assertTrue($sessions->json('sessions.0.current'));

        $revoked = $this->withCookie('uvh_session', $sessionToken)
            ->postJson('/api/v1/auth/sessions/'.rawurlencode((string) $currentId).'/revoke', []);
        $revoked->assertStatus(200)->assertExactJson(['ok' => true, 'current' => true]);
        $this->withCookie('uvh_session', $sessionToken)->getJson('/api/v1/auth/me')->assertStatus(401);
    }

    public function test_registration_captcha_is_single_use_and_honeypot_is_rejected(): void
    {
        $honeypot = array_merge([
            'name' => 'Bot User',
            'email' => 'bot@example.com',
            'password' => self::PASSWORD,
            'website' => 'filled-by-bot',
        ], $this->captchaPayload());
        $this->postJson('/api/v1/auth/register', $honeypot)
            ->assertStatus(422)
            ->assertJson(['error' => 'Datos inválidos']);

        $validCaptcha = $this->captchaPayload();
        $this->postJson('/api/v1/auth/register', array_merge([
            'name' => 'Captcha User',
            'email' => 'captcha@example.com',
            'password' => self::PASSWORD,
        ], $validCaptcha))->assertStatus(201);

        // A successful challenge is consumed and cannot be replayed for another account.
        $this->postJson('/api/v1/auth/register', array_merge([
            'name' => 'Replay User',
            'email' => 'replay@example.com',
            'password' => self::PASSWORD,
        ], $validCaptcha))->assertStatus(422);
    }

    public function test_link_crud_and_redirect_contract(): void
    {
        $sessionToken = $this->registerVerifiedLogin('links@example.com');

        $create = $this->withCookie('uvh_session', $sessionToken)->postJson('/api/v1/links', [
            'destination' => 'https://example.com/landing',
            'alias' => 'parityalias',
        ]);
        $create->assertStatus(201)->assertJsonStructure(['link' => [
            'id', 'alias', 'destination', 'fallbackDestination', 'state', 'clickCount',
            'maxClicks', 'singleUse', 'usedAt', 'scheduledAt', 'expiresAt', 'notes',
            'passwordProtected', 'utm', 'domainId', 'domain', 'tags', 'createdAt', 'updatedAt', 'shortUrl',
        ]]);
        $this->assertSame('parityalias', $create->json('link.alias'));
        $this->assertFalse($create->json('link.passwordProtected'));
        $this->expectNoSensitiveFields($create->json());

        $linkId = $create->json('link.id');

        $list = $this->withCookie('uvh_session', $sessionToken)->getJson('/api/v1/links');
        $list->assertStatus(200)->assertJsonStructure(['links', 'total', 'page', 'perPage']);
        $this->assertSame(1, $list->json('total'));

        $this->withCookie('uvh_session', $sessionToken)->getJson("/api/v1/links/{$linkId}")
            ->assertStatus(200)->assertJsonStructure(['link', 'rules']);

        $this->withCookie('uvh_session', $sessionToken)
            ->postJson("/api/v1/links/{$linkId}/state", ['state' => 'paused'])
            ->assertStatus(200)->assertJson(['ok' => true, 'state' => 'paused']);

        // Paused links are unavailable (404 HTML), not a redirect.
        $redirect = $this->call('GET', 'http://uvh.es/parityalias');
        $this->assertSame(404, $redirect->getStatusCode());

        // Reactivate and resolve.
        $this->withCookie('uvh_session', $sessionToken)
            ->postJson("/api/v1/links/{$linkId}/state", ['state' => 'active'])
            ->assertStatus(200);

        $redirect = $this->call('GET', 'http://uvh.es/parityalias');
        $this->assertSame(302, $redirect->getStatusCode());
        $this->assertSame('https://example.com/landing', $redirect->headers->get('Location'));

        // Soft delete + restore.
        $this->withCookie('uvh_session', $sessionToken)
            ->deleteJson("/api/v1/links/{$linkId}")
            ->assertStatus(200)->assertJson(['ok' => true]);

        $this->withCookie('uvh_session', $sessionToken)
            ->postJson("/api/v1/links/{$linkId}/restore", [])
            ->assertStatus(200)->assertJson(['ok' => true]);
    }

    public function test_rules_round_trip_and_partial_patch_preserves_nested_data(): void
    {
        $sessionToken = $this->registerVerifiedLogin('rules@example.com');
        $create = $this->withCookie('uvh_session', $sessionToken)->postJson('/api/v1/links', [
            'destination' => 'https://example.com/original',
            'alias' => 'rules-contract',
            'tags' => ['campaign'],
            'rules' => [[
                'priority' => 0,
                'country' => 'ES',
                'timeFrom' => '08:00',
                'timeTo' => '20:00',
                'destination' => 'https://example.com/spain',
            ]],
        ]);
        $create->assertStatus(201);
        $id = $create->json('link.id');

        $detail = $this->withCookie('uvh_session', $sessionToken)->getJson("/api/v1/links/{$id}");
        $detail->assertStatus(200)->assertJsonPath('rules.0.timeFrom', '08:00')->assertJsonPath('rules.0.timeTo', '20:00');
        $this->assertSame(['campaign'], $detail->json('link.tags'));

        // A partial update must not clear nested fields omitted from the PATCH.
        $this->withCookie('uvh_session', $sessionToken)
            ->patchJson("/api/v1/links/{$id}", ['destination' => 'https://example.com/edited'])
            ->assertStatus(200);
        $after = $this->withCookie('uvh_session', $sessionToken)->getJson("/api/v1/links/{$id}");
        $after->assertJsonPath('rules.0.destination', 'https://example.com/spain');
        $this->assertSame(['campaign'], $after->json('link.tags'));

        $this->withCookie('uvh_session', $sessionToken)
            ->postJson('/api/v1/links', ['destination' => 'https://example.com', 'expiresAt' => 'not-a-date'])
            ->assertStatus(422);
    }

    public function test_error_envelope_for_unknown_routes_and_bad_input(): void
    {
        $this->getJson('/api/v1/does-not-exist')
            ->assertStatus(404)->assertJson(['error' => 'Ruta no encontrada']);

        $this->postJson('/api/v1/auth/login', ['email' => 'not-an-email', 'password' => 'x'])
            ->assertStatus(422)->assertJsonStructure(['error']);
    }

    public function test_unauthorized_endpoints_return_error_envelope(): void
    {
        $this->getJson('/api/v1/auth/me')->assertStatus(401)->assertJson(['error' => 'No autenticado']);
        $this->getJson('/api/v1/admin/overview')->assertStatus(401)->assertJson(['error' => 'No autenticado']);
    }

    /** @return array{captchaChallenge: string, captchaAnswer: string} */
    private function captchaPayload(): array
    {
        $captcha = $this->getJson('/api/v1/auth/captcha')->assertStatus(200);
        preg_match_all('/\\d+/', (string) $captcha->json('prompt'), $matches);
        $numbers = array_map('intval', $matches[0] ?? []);
        $this->assertCount(2, $numbers);

        return [
            'captchaChallenge' => (string) $captcha->json('challenge'),
            'captchaAnswer' => (string) ($numbers[0] + $numbers[1]),
            'acceptTerms' => true,
            'termsVersion' => '2026-08-19',
        ];
    }

    private function registerVerifiedLogin(string $email): string
    {
        $this->postJson('/api/v1/auth/register', array_merge([
            'name' => 'Contract User',
            'email' => $email,
            'password' => self::PASSWORD,
        ], $this->captchaPayload()))->assertStatus(201);

        $user = User::where('email', $email)->firstOrFail();
        $plain = 'verify-'.Ids::randomToken(16);
        DB::table('email_tokens')->insert([
            'id' => Ids::sha256Hex($plain),
            'user_id' => $user->id,
            'kind' => 'verify',
            'expires_at' => now()->addHour(),
            'created_at' => now(),
        ]);

        $this->postJson('/api/v1/auth/verify-email', ['token' => $plain])
            ->assertStatus(200)->assertJson(['ok' => true]);

        $login = $this->postJson('/api/v1/auth/login', [
            'email' => $email,
            'password' => self::PASSWORD,
        ]);
        $login->assertStatus(200);

        return $this->cookieFrom($login, 'uvh_session');
    }

    private function cookieFrom($response, string $name): ?string
    {
        foreach ($response->headers->getCookies() as $cookie) {
            if ($cookie->getName() === $name) {
                return $cookie->getValue();
            }
        }

        return null;
    }

    private function expectNoSensitiveFields(array $body): void
    {
        $json = json_encode($body, JSON_UNESCAPED_UNICODE);
        foreach (['password_hash', 'passwordHash', 'token_hash', 'tokenHash', 'mfa_secret', 'mfaSecret', 'recovery_codes', 'recoveryCodes'] as $key) {
            $this->assertStringNotContainsString('"'.$key.'"', $json);
        }
    }
}
