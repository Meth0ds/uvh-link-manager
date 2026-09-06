<?php

namespace Tests\Feature;

use App\Exceptions\LinkException;
use App\Http\Middleware\RecordOperationalResponse;
use App\Jobs\ProvisionDomainTlsJob;
use App\Jobs\VerifyDomainDnsJob;
use App\Models\User;
use App\Models\Webhook;
use App\Support\Ids;
use App\Support\LinkService;
use App\Support\UvhCrypto;
use Carbon\Carbon;
use Illuminate\Contracts\Cache\Lock;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Mockery;
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

    // Must satisfy the server-side PasswordStrength policy (no common
    // substrings, score >= 30) because it is used for real registrations.
    private const PASSWORD = 'tiovivo-cobrizo-astilla-42';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, invitations, quotas, custom_domains, links, tags, link_tags, redirect_rules, click_events, metric_rollups, metric_unique_visitors, api_tokens, webhooks, webhook_deliveries, abuse_reports, audit_events, email_tokens, mail_outbox, operational_metrics, jobs, failed_jobs RESTART IDENTITY CASCADE');

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
            'captchaToken' => 'test-login-passcode',
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
            'captchaToken' => 'test-login-passcode',
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

    public function test_link_intent_contract(): void
    {
        $issued = $this->postJson('/api/v1/link-intents', [
            'destination' => 'https://example.com/campaign?utm_source=uvh',
        ]);
        $issued->assertCreated()->assertJsonStructure(['intent', 'expiresAt']);
        $this->assertArrayNotHasKey('destination', $issued->json());
        $intent = $issued->json('intent');
        $this->assertIsString($intent);
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]{43}$/', $intent);
        $this->assertTrue(now()->diffInHours(Carbon::parse($issued->json('expiresAt')), false) >= 23);

        $ownerSession = $this->registerVerifiedLogin('intent-owner@example.com');
        $claimed = $this->withCookie('uvh_session', $ownerSession)
            ->postJson('/api/v1/link-intents/claim', ['intent' => $intent]);
        $claimed->assertOk()->assertExactJson([
            'destination' => 'https://example.com/campaign?utm_source=uvh',
            'expiresAt' => $issued->json('expiresAt'),
        ]);

        $otherSession = $this->registerVerifiedLogin('intent-other@example.com');
        $this->withCookie('uvh_session', $otherSession)
            ->postJson('/api/v1/link-intents/claim', ['intent' => $intent])
            ->assertNotFound()->assertJson(['error' => 'La URL guardada ya no está disponible']);

        $this->withCookie('uvh_session', $ownerSession)
            ->postJson('/api/v1/link-intents/claim', ['intent' => $intent])
            ->assertOk()->assertJsonPath('destination', 'https://example.com/campaign?utm_source=uvh');

        $this->withCookie('uvh_session', $ownerSession)
            ->postJson('/api/v1/link-intents/complete', ['intent' => $intent])
            ->assertOk()->assertExactJson(['ok' => true]);
        $this->withCookie('uvh_session', $ownerSession)
            ->postJson('/api/v1/link-intents/claim', ['intent' => $intent])
            ->assertNotFound();

        $this->postJson('/api/v1/link-intents', ['destination' => 'ftp://example.com'])
            ->assertStatus(422)->assertJson(['error' => 'Solo se permiten URLs http/https']);
    }

    public function test_link_intent_limit_releases_expired_staggered_buckets(): void
    {
        foreach (range(1, 10) as $index) {
            $this->postJson('/api/v1/link-intents', [
                'destination' => "https://example.com/first/{$index}",
            ])->assertCreated();
        }

        $this->travel(12)->hours();
        foreach (range(1, 10) as $index) {
            $this->postJson('/api/v1/link-intents', [
                'destination' => "https://example.com/second/{$index}",
            ])->assertCreated();
        }

        $this->travel(13)->hours();
        $this->postJson('/api/v1/link-intents', [
            'destination' => 'https://example.com/after-expiry',
        ])->assertCreated();
    }

    public function test_consumed_link_intent_stays_successful_when_counter_cleanup_is_unavailable(): void
    {
        $issued = $this->postJson('/api/v1/link-intents', ['destination' => 'https://example.com/cleanup']);
        $intent = $issued->json('intent');
        $session = $this->registerVerifiedLogin('intent-cleanup@example.com');
        $this->withCookie('uvh_session', $session)
            ->postJson('/api/v1/link-intents/claim', ['intent' => $intent])->assertOk();

        $cache = Cache::getFacadeRoot();
        $cacheMock = Mockery::mock($cache)->makePartial();
        $unavailable = Mockery::mock(Lock::class);
        $unavailable->shouldReceive('get')->once()->andReturnFalse();
        $cacheMock->shouldReceive('lock')->andReturnUsing(
            static function (string $name, int $seconds = 0, ?string $owner = null) use ($cache, $unavailable) {
                return $name === 'link-intent-active:global:lock'
                    ? $unavailable
                    : $cache->lock($name, $seconds, $owner);
            }
        );
        Cache::swap($cacheMock);
        try {
            $this->withCookie('uvh_session', $session)
                ->postJson('/api/v1/link-intents/complete', ['intent' => $intent])
                ->assertOk()->assertExactJson(['ok' => true]);
        } finally {
            Cache::swap($cache);
        }

        $this->withCookie('uvh_session', $session)
            ->postJson('/api/v1/link-intents/claim', ['intent' => $intent])->assertNotFound();
    }

    public function test_link_intent_completion_does_not_claim_success_when_delete_is_rejected(): void
    {
        $issued = $this->postJson('/api/v1/link-intents', ['destination' => 'https://example.com/delete']);
        $intent = $issued->json('intent');
        $session = $this->registerVerifiedLogin('intent-delete@example.com');
        $this->withCookie('uvh_session', $session)
            ->postJson('/api/v1/link-intents/claim', ['intent' => $intent])->assertOk();

        $cache = Cache::getFacadeRoot();
        $cacheMock = Mockery::mock($cache)->makePartial();
        $cacheMock->shouldReceive('forget')->once()->andReturnFalse();
        Cache::swap($cacheMock);
        try {
            $this->withCookie('uvh_session', $session)
                ->postJson('/api/v1/link-intents/complete', ['intent' => $intent])->assertStatus(503);
        } finally {
            Cache::swap($cache);
        }

        // The failed deletion remains retryable and restores its inverse index.
        $this->withCookie('uvh_session', $session)
            ->postJson('/api/v1/link-intents/claim', ['intent' => $intent])->assertOk();
        $this->withCookie('uvh_session', $session)
            ->postJson('/api/v1/link-intents/complete', ['intent' => $intent])->assertOk();
    }

    public function test_new_workspace_response_immediately_reports_owner_role(): void
    {
        $session = $this->registerVerifiedLogin('workspace-create@example.com');

        $this->withCookie('uvh_session', $session)
            ->postJson('/api/v1/workspaces', ['name' => 'Operaciones'])
            ->assertCreated()
            ->assertJsonPath('workspace.role', 'owner');
    }

    public function test_an_already_consumed_mfa_challenge_cannot_create_a_session(): void
    {
        $this->registerVerifiedLogin('mfa-race@example.com');
        $user = User::where('email', 'mfa-race@example.com')->firstOrFail();
        $secret = 'JBSWY3DPEHPK3PXP';
        $user->update([
            'mfa_enabled' => true,
            'mfa_secret' => UvhCrypto::encryptAtRest($secret),
            'security_version' => 2,
        ]);

        $login = $this->postJson('/api/v1/auth/login', [
            'email' => $user->email,
            'password' => self::PASSWORD,
            'captchaToken' => 'test-login-passcode',
        ])->assertOk()->assertJsonPath('mfaRequired', true);
        $challenge = (string) $login->json('challenge');
        Cache::put('uvh:mfa:challenge:'.Ids::sha256Hex($challenge).':consumed', true, now()->addMinutes(5));

        $verified = $this->postJson('/api/v1/auth/mfa/verify', [
            'challenge' => $challenge,
            'code' => $this->totpCode($secret),
        ]);
        $verified->assertUnauthorized()->assertExactJson(['error' => 'Sesión MFA caducada']);
        $this->assertNull($this->cookieFrom($verified, 'uvh_session'));
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
        $login = $this->postJson('/api/v1/auth/login', [
            'email' => $newEmail,
            'password' => self::PASSWORD,
            'captchaToken' => 'test-login-passcode',
        ])->assertStatus(200);
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

    public function test_hcaptcha_is_verified_server_side_and_honeypot_is_rejected_before_provider_call(): void
    {
        Http::swap(new HttpFactory);
        Http::fake([
            'https://api.hcaptcha.com/siteverify' => Http::response(['success' => true, 'hostname' => 'app.uvh.test']),
        ]);
        $honeypot = array_merge([
            'name' => 'Bot User',
            'email' => 'bot@example.com',
            'password' => self::PASSWORD,
            'website' => 'filled-by-bot',
        ], $this->captchaPayload());
        $this->postJson('/api/v1/auth/register', $honeypot)
            ->assertStatus(422)
            ->assertJson(['error' => 'Datos inválidos']);
        Http::assertNothingSent();

        Http::swap(new HttpFactory);
        Http::fake([
            'https://api.hcaptcha.com/siteverify' => Http::sequence()
                ->push(['success' => true, 'hostname' => 'app.uvh.test'], 200)
                ->push(['success' => false, 'error-codes' => ['already-seen-response']], 200),
        ]);
        $validCaptcha = $this->captchaPayload();
        $this->postJson('/api/v1/auth/register', array_merge([
            'name' => 'Captcha User',
            'email' => 'captcha@example.com',
            'password' => self::PASSWORD,
        ], $validCaptcha))->assertStatus(201);

        // hCaptcha rejects a passcode replay and the API never trusts the
        // browser token without a fresh server-to-server verification.
        $this->postJson('/api/v1/auth/register', array_merge([
            'name' => 'Replay User',
            'email' => 'replay@example.com',
            'password' => self::PASSWORD,
        ], $validCaptcha))->assertStatus(422)
            ->assertJson(['error' => 'Completa de nuevo la verificación antiabuso.']);
        Http::assertSentCount(2);
        $this->assertDatabaseHas('operational_metrics', ['metric' => 'hcaptcha.valid']);
        $this->assertDatabaseHas('operational_metrics', ['metric' => 'hcaptcha.invalid']);
    }

    public function test_hcaptcha_provider_outage_fails_closed_without_becoming_a_500(): void
    {
        Http::swap(new HttpFactory);
        Http::fake([
            'https://api.hcaptcha.com/siteverify' => Http::response('upstream unavailable', 503),
        ]);

        $this->postJson('/api/v1/auth/login', [
            'email' => 'person@example.com',
            'password' => self::PASSWORD,
            'captchaToken' => 'test-login-passcode',
        ])->assertStatus(503)->assertJson([
            'error' => 'La verificación antiabuso no está disponible. Espera un momento y vuelve a intentarlo.',
        ]);
        $this->assertDatabaseHas('operational_metrics', ['metric' => 'hcaptcha.unavailable']);
    }

    public function test_operational_response_records_429_without_request_dimensions(): void
    {
        // Exercise the global response observer directly so this contract does
        // not depend on a particular named limiter or consume another test's
        // shared cache budget. Only the fixed metric name reaches storage.
        $middleware = new RecordOperationalResponse;
        $response = $middleware->handle(
            Request::create('/synthetic-rate-limit', 'GET'),
            static fn () => response('', 429),
        );

        $this->assertSame(429, $response->getStatusCode());
        $this->assertDatabaseHas('operational_metrics', [
            'metric' => 'http.too_many_requests',
            'count' => 1,
        ]);
    }

    public function test_hcaptcha_token_for_another_hostname_is_rejected(): void
    {
        Http::swap(new HttpFactory);
        Http::fake([
            'https://api.hcaptcha.com/siteverify' => Http::response([
                'success' => true,
                'hostname' => 'attacker.example.test',
            ]),
        ]);

        $this->postJson('/api/v1/auth/login', [
            'email' => 'person@example.com',
            'password' => self::PASSWORD,
            'captchaToken' => 'token-from-another-host',
        ])->assertStatus(422)->assertJson([
            'error' => 'Completa de nuevo la verificación antiabuso.',
        ]);
    }

    public function test_official_hcaptcha_test_hostname_is_accepted_only_with_the_official_test_sitekey(): void
    {
        Http::swap(new HttpFactory);
        Http::fake([
            'https://api.hcaptcha.com/siteverify' => Http::response([
                'success' => true,
                'hostname' => 'dummy-key-pass',
            ]),
        ]);

        // Official pass-through credentials intentionally return the
        // synthetic hostname instead of the local browser host. Reaching the
        // generic credentials response proves CAPTCHA verification passed.
        $this->postJson('/api/v1/auth/login', [
            'email' => 'unknown-test-key@example.com',
            'password' => self::PASSWORD,
            'captchaToken' => 'official-test-passcode',
        ])->assertStatus(401)->assertExactJson(['error' => 'Credenciales incorrectas']);

        // The sentinel must not become a general hostname bypass for custom
        // or production sitekeys.
        config(['uvh.hcaptcha.site_key' => 'custom-site-key-that-is-not-the-official-test-key']);
        $this->postJson('/api/v1/auth/login', [
            'email' => 'unknown-custom-key@example.com',
            'password' => self::PASSWORD,
            'captchaToken' => 'custom-key-passcode',
        ])->assertStatus(422)->assertJson([
            'error' => 'Completa de nuevo la verificación antiabuso.',
        ]);
    }

    public function test_unknown_login_uses_a_valid_dummy_hash_and_returns_generic_credentials_error(): void
    {
        $this->postJson('/api/v1/auth/login', [
            'email' => 'unknown@example.com',
            'password' => self::PASSWORD,
            'captchaToken' => 'test-login-passcode',
        ])->assertStatus(401)->assertExactJson(['error' => 'Credenciales incorrectas']);
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
            ->patchJson("/api/v1/links/{$id}", [
                'destination' => 'https://example.com/edited',
                'version' => $create->json('link.version'),
            ])
            ->assertStatus(200);
        $after = $this->withCookie('uvh_session', $sessionToken)->getJson("/api/v1/links/{$id}");
        $after->assertJsonPath('rules.0.destination', 'https://example.com/spain');
        $this->assertSame(['campaign'], $after->json('link.tags'));

        $this->withCookie('uvh_session', $sessionToken)
            ->postJson('/api/v1/links', ['destination' => 'https://example.com', 'expiresAt' => 'not-a-date'])
            ->assertStatus(422);
        $this->withCookie('uvh_session', $sessionToken)
            ->postJson('/api/v1/links', ['destination' => 'https://example.com', 'expiresAt' => 'tomorrow'])
            ->assertStatus(422);

        $this->withCookie('uvh_session', $sessionToken)
            ->postJson('/api/v1/links', [
                'destination' => 'https://example.com',
                'scheduledAt' => now()->addDays(2)->toIso8601String(),
                'expiresAt' => now()->addDay()->toIso8601String(),
            ])
            ->assertUnprocessable()
            ->assertJson(['error' => 'La caducidad debe ser posterior a la fecha de activación']);
    }

    public function test_processing_webhook_delivery_cannot_be_rewound_by_manual_resend(): void
    {
        $session = $this->registerVerifiedLogin('webhook-resend@example.com');
        $user = User::where('email', 'webhook-resend@example.com')->firstOrFail();
        $workspaceId = (int) DB::table('workspaces')->where('owner_user_id', $user->id)->value('id');
        $webhook = Webhook::create([
            'workspace_id' => $workspaceId,
            'created_by' => $user->id,
            'url' => 'https://example.com/hook',
            'secret' => UvhCrypto::encryptAtRest('regression-secret-1234'),
            'events' => ['link.created'],
            'active' => true,
            'config_version' => 1,
        ]);
        $deliveryId = DB::table('webhook_deliveries')->insertGetId([
            'webhook_id' => $webhook->id,
            'config_version' => 1,
            'event' => 'link.created',
            'event_id' => 'processing-regression',
            'payload' => json_encode(['event' => 'link.created', 'event_id' => 'processing-regression', 'data' => []]),
            'status' => 'processing',
            'attempts' => 1,
            'locked_at' => now(),
            'created_at' => now(),
        ]);

        $this->withCookie('uvh_session', $session)
            ->withHeader('X-Workspace-Id', (string) $workspaceId)
            ->postJson("/api/v1/webhooks/{$webhook->id}/deliveries/{$deliveryId}/resend")
            ->assertConflict();
        $this->assertDatabaseHas('webhook_deliveries', [
            'id' => $deliveryId,
            'status' => 'processing',
            'attempts' => 1,
        ]);
        $deliveries = $this->withCookie('uvh_session', $session)
            ->withHeader('X-Workspace-Id', (string) $workspaceId)
            ->getJson("/api/v1/webhooks/{$webhook->id}/deliveries")
            ->assertOk()
            ->assertJsonPath('deliveries.0.event_id', 'processing-regression');
        $this->assertArrayNotHasKey('payload', $deliveries->json('deliveries.0'));
    }

    public function test_stale_link_update_is_rejected_without_overwriting_the_newer_edit(): void
    {
        $sessionToken = $this->registerVerifiedLogin('stale-link@example.com');
        $create = $this->withCookie('uvh_session', $sessionToken)->postJson('/api/v1/links', [
            'destination' => 'https://example.com/original',
            'alias' => 'stale-contract',
        ])->assertCreated();
        $id = $create->json('link.id');
        $version = $create->json('link.version');

        $this->withCookie('uvh_session', $sessionToken)
            ->patchJson("/api/v1/links/{$id}", [
                'destination' => 'https://example.com/newer',
                'version' => $version,
            ])->assertOk();

        $this->withCookie('uvh_session', $sessionToken)
            ->patchJson("/api/v1/links/{$id}", [
                'destination' => 'https://example.com/stale',
                'version' => $version,
            ])->assertConflict()->assertJson([
                'error' => 'Este enlace cambió en otro lugar. Recárgalo antes de guardar.',
            ]);

        $this->withCookie('uvh_session', $sessionToken)
            ->getJson("/api/v1/links/{$id}")
            ->assertOk()->assertJsonPath('link.destination', 'https://example.com/newer');
    }

    public function test_password_change_keeps_the_current_session_and_revokes_other_sessions(): void
    {
        $firstSession = $this->registerVerifiedLogin('password-rotation@example.com');
        $secondLogin = $this->postJson('/api/v1/auth/login', [
            'email' => 'password-rotation@example.com',
            'password' => self::PASSWORD,
            'captchaToken' => 'test-login-passcode',
        ])->assertOk();
        $secondSession = $this->cookieFrom($secondLogin, 'uvh_session');
        $this->assertNotNull($secondSession);

        $this->withCookie('uvh_session', $firstSession)
            ->postJson('/api/v1/auth/change-password', [
                'current' => self::PASSWORD,
                'newPassword' => 'tiovivo-astilla-9931',
            ])->assertOk()->assertExactJson(['ok' => true]);

        $this->withCookie('uvh_session', $firstSession)->getJson('/api/v1/auth/me')->assertOk();
        $this->withCookie('uvh_session', $secondSession)->getJson('/api/v1/auth/me')->assertStatus(401);
        $this->postJson('/api/v1/auth/login', [
            'email' => 'password-rotation@example.com',
            'password' => self::PASSWORD,
            'captchaToken' => 'test-login-passcode',
        ])->assertStatus(401);
        $this->postJson('/api/v1/auth/login', [
            'email' => 'password-rotation@example.com',
            'password' => 'tiovivo-astilla-9931',
            'captchaToken' => 'test-login-passcode',
        ])->assertOk();
    }

    public function test_webhook_delivery_locks_block_configuration_and_member_removal(): void
    {
        $ownerSession = $this->registerVerifiedLogin('webhook-owner@example.com');
        $owner = User::where('email', 'webhook-owner@example.com')->firstOrFail();
        $workspaceId = (int) DB::table('workspaces')->where('owner_user_id', $owner->id)->value('id');
        $memberSession = $this->registerVerifiedLogin('webhook-member@example.com');
        $member = User::where('email', 'webhook-member@example.com')->firstOrFail();
        DB::table('memberships')->insert([
            'workspace_id' => $workspaceId,
            'user_id' => $member->id,
            'role' => 'editor',
            'created_at' => now(),
        ]);
        $webhook = Webhook::create([
            'workspace_id' => $workspaceId,
            'created_by' => $member->id,
            'url' => 'https://example.com/uvh-webhook',
            'secret' => 'test-only-secret',
            'events' => ['link.created'],
            'active' => true,
            'config_version' => 1,
        ]);

        $lock = Cache::lock('uvh:webhook-config:'.$webhook->id, 30);
        $this->assertTrue($lock->get());
        try {
            $this->withCookie('uvh_session', $memberSession)
                ->withHeader('X-Workspace-Id', (string) $workspaceId)
                ->patchJson('/api/v1/webhooks/'.$webhook->id, ['active' => false])
                ->assertConflict();
            $this->withCookie('uvh_session', $ownerSession)
                ->deleteJson('/api/v1/workspaces/'.$workspaceId.'/members/'.$member->id)
                ->assertConflict();
            $this->assertDatabaseHas('memberships', ['workspace_id' => $workspaceId, 'user_id' => $member->id]);
            $this->assertDatabaseHas('webhooks', ['id' => $webhook->id, 'active' => true]);
        } finally {
            $lock->release();
        }

        $this->withCookie('uvh_session', $ownerSession)
            ->deleteJson('/api/v1/workspaces/'.$workspaceId.'/members/'.$member->id)
            ->assertOk()->assertExactJson(['ok' => true]);
        $this->assertDatabaseMissing('memberships', ['workspace_id' => $workspaceId, 'user_id' => $member->id]);
        $this->assertDatabaseHas('webhooks', ['id' => $webhook->id, 'active' => false]);
    }

    public function test_error_envelope_for_unknown_routes_and_bad_input(): void
    {
        $this->getJson('/api/v1/does-not-exist')
            ->assertStatus(404)->assertJson(['error' => 'Ruta no encontrada']);

        $this->postJson('/api/v1/auth/login', ['email' => 'not-an-email', 'password' => 'x'])
            ->assertStatus(422)->assertJsonStructure(['error']);
    }

    public function test_malformed_json_types_return_4xx_instead_of_500(): void
    {
        $this->postJson('/api/v1/auth/login', ['email' => [], 'password' => 'x'])
            ->assertStatus(422)->assertJson(['error' => 'Datos inválidos']);
        $this->postJson('/api/v1/link-intents', ['destination' => ['https://example.com']])
            ->assertStatus(422)->assertJsonStructure(['error']);

        $email = 'typed-input@example.com';
        $session = $this->registerVerifiedLogin($email);
        $user = User::where('email', $email)->firstOrFail();
        $workspaceId = (int) DB::table('memberships')->where('user_id', $user->id)->value('workspace_id');
        $authorized = $this->withCookie('uvh_session', $session)->withHeaders(['X-Workspace-Id' => (string) $workspaceId]);

        $authorized->postJson('/api/v1/tokens', [
            'name' => 'Malformed scopes',
            'scopes' => [['links:read']],
        ])->assertStatus(422)->assertJsonStructure(['error']);
        $authorized->postJson('/api/v1/tokens', [
            'name' => 'Relative expiry',
            'scopes' => ['links:read'],
            'expiresAt' => 'tomorrow',
        ])->assertStatus(422)->assertJsonStructure(['error']);
        $authorized->postJson('/api/v1/domains', ['domain' => ['go.example.com']])
            ->assertStatus(422)->assertJsonStructure(['error']);
    }

    public function test_link_service_rechecks_membership_inside_its_transaction(): void
    {
        $email = 'revoked-writer@example.com';
        $this->registerVerifiedLogin($email);
        $user = User::where('email', $email)->firstOrFail();
        $workspaceId = (int) DB::table('memberships')->where('user_id', $user->id)->value('workspace_id');
        DB::table('memberships')->where('workspace_id', $workspaceId)->where('user_id', $user->id)->delete();

        try {
            LinkService::create($workspaceId, $user->id, ['destination' => 'https://example.com']);
            $this->fail('A revoked member must not create a link through a stale pre-authorized request.');
        } catch (LinkException $e) {
            $this->assertSame(403, $e->status);
        }
        $this->assertDatabaseMissing('links', ['workspace_id' => $workspaceId]);
    }

    public function test_domain_verification_tls_provisioning_and_disabled_revalidation_are_queued(): void
    {
        Queue::fake();
        $email = 'domain-flow@example.com';
        $session = $this->registerVerifiedLogin($email);
        $user = User::where('email', $email)->firstOrFail();
        $workspaceId = (int) DB::table('memberships')->where('user_id', $user->id)->value('workspace_id');
        $authorized = $this->withCookie('uvh_session', $session)->withHeaders(['X-Workspace-Id' => (string) $workspaceId]);
        $created = $authorized->postJson('/api/v1/domains', ['domain' => 'go.example.test'])
            ->assertCreated();
        $domainId = (int) $created->json('domain.id');

        $authorized->postJson('/api/v1/domains/'.$domainId.'/verify')
            ->assertStatus(202)->assertJson(['ok' => true, 'state' => 'verifying']);
        Queue::assertPushed(VerifyDomainDnsJob::class, fn (VerifyDomainDnsJob $job) => $job->domainId === $domainId);
        $this->assertDatabaseHas('custom_domains', ['id' => $domainId, 'state' => 'verifying']);

        Cache::lock('uvh:domain-verification:'.$workspaceId.':'.$domainId)->forceRelease();
        // Simulate the successful, version-matched DNS worker result. A
        // domain must never become edge-active from a stale `disabled` row:
        // activation first requires fresh ownership and routing evidence.
        DB::table('custom_domains')->where('id', $domainId)->update([
            'state' => 'verified',
            'verified_at' => now(),
            'ownership_verified_at' => now(),
            'routing_verified_at' => now(),
            'dns_check_completed_at' => now(),
            'dns_error' => null,
        ]);
        $authorized->postJson('/api/v1/domains/'.$domainId.'/activate')
            ->assertStatus(202)->assertJson(['state' => 'provisioning']);
        Queue::assertPushed(ProvisionDomainTlsJob::class, fn (ProvisionDomainTlsJob $job) => $job->domainId === $domainId);

        $authorized->postJson('/api/v1/domains/'.$domainId.'/disable')
            ->assertOk()->assertJson(['state' => 'disabled']);

        // Queue::fake() cannot run the worker that normally releases its
        // owner-scoped lock, so explicitly release only this fixture's lock.
        Cache::lock('uvh:domain-verification:'.$workspaceId.':'.$domainId)->forceRelease();
        $authorized->postJson('/api/v1/domains/'.$domainId.'/revalidate')
            ->assertStatus(202)->assertJson(['ok' => true, 'state' => 'disabled']);
        $this->assertDatabaseHas('custom_domains', ['id' => $domainId, 'state' => 'disabled', 'edge_eligible' => false]);
    }

    public function test_queue_admission_failure_does_not_undo_a_created_link(): void
    {
        $email = 'queue-failure@example.com';
        $session = $this->registerVerifiedLogin($email);
        $user = User::where('email', $email)->firstOrFail();
        $workspaceId = (int) DB::table('memberships')->where('user_id', $user->id)->value('workspace_id');
        Webhook::create([
            'workspace_id' => $workspaceId,
            'created_by' => $user->id,
            'url' => 'https://example.com/webhook',
            'secret' => UvhCrypto::encryptAtRest('queue-failure-secret'),
            'events' => ['link.created'],
            'active' => true,
        ]);
        config(['queue.default' => 'missing-connection']);

        $created = $this->withCookie('uvh_session', $session)
            ->withHeaders(['X-Workspace-Id' => (string) $workspaceId])
            ->postJson('/api/v1/links', ['destination' => 'https://example.com/committed']);

        $created->assertCreated()->assertJsonStructure(['link' => ['id']]);
        $this->assertDatabaseHas('links', ['id' => $created->json('link.id'), 'workspace_id' => $workspaceId]);
        $this->assertDatabaseHas('webhook_deliveries', ['status' => 'pending']);
    }

    public function test_housekeeping_purges_old_terminal_deliveries_and_failed_jobs(): void
    {
        $email = 'retention@example.com';
        $this->registerVerifiedLogin($email);
        $user = User::where('email', $email)->firstOrFail();
        $workspaceId = (int) DB::table('memberships')->where('user_id', $user->id)->value('workspace_id');
        $oldTrashId = DB::table('links')->insertGetId([
            'workspace_id' => $workspaceId, 'created_by' => $user->id,
            'alias' => 'expired-trash', 'destination' => 'https://example.com/expired-trash',
            'state' => 'deleted', 'state_before_delete' => 'active', 'version' => 2,
            'deleted_at' => now()->subDays(31), 'created_at' => now()->subDays(40), 'updated_at' => now()->subDays(31),
        ]);
        $freshTrashId = DB::table('links')->insertGetId([
            'workspace_id' => $workspaceId, 'created_by' => $user->id,
            'alias' => 'fresh-trash', 'destination' => 'https://example.com/fresh-trash',
            'state' => 'deleted', 'state_before_delete' => 'active', 'version' => 2,
            'deleted_at' => now()->subDays(29), 'created_at' => now()->subDays(40), 'updated_at' => now()->subDays(29),
        ]);
        $webhook = Webhook::create([
            'workspace_id' => $workspaceId,
            'created_by' => $user->id,
            'url' => 'https://example.com/webhook',
            'secret' => UvhCrypto::encryptAtRest('retention-secret-1234'),
            'events' => ['link.created'],
            'active' => true,
        ]);
        foreach (['failed', 'success'] as $status) {
            DB::table('webhook_deliveries')->insert([
                'webhook_id' => $webhook->id,
                'config_version' => 1,
                'event' => 'link.created',
                'event_id' => 'old-'.$status,
                'payload' => '{}',
                'status' => $status,
                'attempts' => 5,
                'created_at' => now()->subDays(120),
                'delivered_at' => $status === 'success' ? now()->subDays(120) : null,
            ]);
        }
        DB::table('failed_jobs')->insert([
            'uuid' => '00000000-0000-4000-8000-000000000001',
            'connection' => 'database',
            'queue' => 'default',
            'payload' => '{}',
            'exception' => 'test',
            'failed_at' => now()->subDays(60),
        ]);
        $staleDomainId = DB::table('custom_domains')->insertGetId([
            'workspace_id' => $workspaceId,
            'domain' => 'stale.example.test',
            'verification_token' => 'uvh-verify=stale',
            'state' => 'verifying',
            'created_at' => now()->subHour(),
            'updated_at' => now()->subHour(),
        ]);
        Cache::forget('uvh:housekeeping:last_heavy');

        $this->artisan('uvh:housekeeping')->assertExitCode(0);

        $this->assertDatabaseMissing('webhook_deliveries', ['event_id' => 'old-failed']);
        $this->assertDatabaseMissing('webhook_deliveries', ['event_id' => 'old-success']);
        $this->assertDatabaseMissing('failed_jobs', ['uuid' => '00000000-0000-4000-8000-000000000001']);
        $this->assertDatabaseHas('custom_domains', ['id' => $staleDomainId, 'state' => 'error']);
        $this->assertDatabaseMissing('links', ['id' => $oldTrashId]);
        $this->assertDatabaseHas('links', ['id' => $freshTrashId, 'state' => 'deleted']);
    }

    public function test_unauthorized_endpoints_return_error_envelope(): void
    {
        $this->getJson('/api/v1/auth/me')->assertStatus(401)->assertJson(['error' => 'No autenticado']);
        $this->getJson('/api/v1/admin/overview')->assertStatus(401)->assertJson(['error' => 'No autenticado']);
    }

    /** @return array{captchaToken: string, acceptTerms: true, termsVersion: string, privacyVersion: string} */
    private function captchaPayload(): array
    {
        return [
            'captchaToken' => 'test-registration-passcode',
            'acceptTerms' => true,
            'termsVersion' => '2026-08-30',
            'privacyVersion' => '2026-08-30',
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
            'captchaToken' => 'test-login-passcode',
        ]);
        $login->assertStatus(200);

        return $this->cookieFrom($login, 'uvh_session');
    }

    private function totpCode(string $secret): string
    {
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        $buffer = 0;
        $bits = 0;
        $key = '';
        foreach (str_split($secret) as $character) {
            $buffer = ($buffer << 5) | strpos($alphabet, $character);
            $bits += 5;
            if ($bits >= 8) {
                $bits -= 8;
                $key .= chr(($buffer >> $bits) & 0xFF);
            }
        }
        $counter = intdiv(time(), 30);
        $hash = hash_hmac('sha1', pack('N', 0).pack('N', $counter), $key, true);
        $offset = ord($hash[strlen($hash) - 1]) & 0x0F;
        $binary = ((ord($hash[$offset]) & 0x7F) << 24)
            | (ord($hash[$offset + 1]) << 16)
            | (ord($hash[$offset + 2]) << 8)
            | ord($hash[$offset + 3]);

        return str_pad((string) ($binary % 1_000_000), 6, '0', STR_PAD_LEFT);
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
