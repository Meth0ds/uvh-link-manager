<?php

namespace Tests\Feature;

use App\Models\AccountRecoveryRequest;
use App\Models\User;
use App\Support\Ids;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Public parsing and middleware contracts, exercised before/after extraction. */
final class PublicRecoveryHttpContractTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, mail_outbox, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        Queue::fake();
        Http::preventStrayRequests();
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'public-recovery')->withHeader('X-CSRF-Token', 'public-recovery');
        $this->freezeSecond();
    }

    protected function tearDown(): void
    {
        $this->travelBack();
        parent::tearDown();
    }

    private function unchanged(User $user, array $before): void
    {
        $this->assertSame($before, $user->refresh()->getRawOriginal());
        foreach (['sessions', 'api_tokens', 'mail_outbox', 'audit_outbox', 'audit_events', 'security_incident_audits'] as $table) {
            $this->assertDatabaseCount($table, 0);
        }
        Queue::assertNothingPushed();
    }

    public static function malformedEmails(): array
    {
        return [[null], [['email']], [123], ['invalid-email'], [str_repeat('a', 250).'@example.test']];
    }

    #[DataProvider('malformedEmails')]
    public function test_invalid_email_cannot_create_recovery_or_redeem_captcha(mixed $email): void
    {
        $user = User::factory()->create(['mfa_enabled' => true]);
        $before = $user->refresh()->getRawOriginal();
        $this->postJson('/api/v1/auth/account-recovery/request', ['email' => $email, 'captchaToken' => 'fixture'])
            ->assertStatus(422)->assertExactJson(['error' => 'Email inválido']);
        $this->unchanged($user, $before);
        $this->assertDatabaseCount('account_recovery_requests', 0);
        Http::assertNothingSent();
    }

    public static function captchaFailures(): array
    {
        return [['rejected', 422], ['upstream', 503], ['foreign-host', 422], ['transport', 503]];
    }

    #[DataProvider('captchaFailures')]
    public function test_public_recovery_preserves_invalid_versus_unavailable_captcha(string $mode, int $status): void
    {
        $user = User::factory()->create(['mfa_enabled' => true]);
        $before = $user->refresh()->getRawOriginal();
        Http::swap(new HttpFactory);
        Http::preventStrayRequests();
        $attempts = 0;
        Http::fake(static function () use ($mode, &$attempts) {
            $attempts++;
            if ($mode === 'transport') {
                throw new ConnectionException('Isolated verifier transport outage');
            }

            return Http::response(['success' => $mode === 'foreign-host', 'hostname' => 'untrusted.example.test'], $mode === 'upstream' ? 503 : 200);
        });
        $error = $status === 503
            ? 'La verificación antiabuso no está disponible. Espera un momento y vuelve a intentarlo.'
            : 'Completa de nuevo la verificación antiabuso.';
        $this->postJson('/api/v1/auth/account-recovery/request', ['email' => $user->email, 'captchaToken' => 'fixture'])
            ->assertStatus($status)->assertExactJson(['error' => $error]);
        $this->unchanged($user, $before);
        $this->assertDatabaseCount('account_recovery_requests', 0);
        $this->assertSame(1, $attempts);
        if ($mode !== 'transport') {
            Http::assertSentCount(1);
        }
    }

    public static function publicRoutes(): array
    {
        return [
            ['account-recovery/request'], ['account-recovery/confirm'],
            ['account-recovery/complete'], ['security-incident/revoke'],
        ];
    }

    #[DataProvider('publicRoutes')]
    public function test_csrf_rejection_precedes_every_public_recovery_or_incident_action(string $path): void
    {
        $user = User::factory()->create(['mfa_enabled' => true]);
        $before = $user->refresh()->getRawOriginal();
        $this->withHeader('X-CSRF-Token', 'different')->postJson('/api/v1/auth/'.$path, [
            'email' => $user->email, 'captchaToken' => 'fixture', 'token' => Ids::randomToken(32),
            'password' => 'brujula-limonero-zafiro-93', 'confirmation' => 'RECUPERAR MI CUENTA',
        ])->assertForbidden()->assertExactJson(['error' => 'Token CSRF inválido', 'reason' => 'csrf_rejected']);
        $this->unchanged($user, $before);
        $this->assertDatabaseCount('account_recovery_requests', 0);
        Http::assertNothingSent();
    }

    public static function malformedBearers(): array
    {
        $cases = [];
        foreach (['account-recovery/confirm', 'security-incident/revoke'] as $path) {
            foreach ([null, ['token'], 123, '', str_repeat('a', 42), str_repeat('a', 44), str_repeat('a', 42).'!', str_repeat('a', 43)."\n"] as $index => $token) {
                $cases[$path.'-'.$index] = [$path, $token];
            }
        }

        return $cases;
    }

    #[DataProvider('malformedBearers')]
    public function test_malformed_public_bearers_cannot_change_security_or_issue_a_session(string $path, mixed $token): void
    {
        $user = User::factory()->create(['mfa_enabled' => true]);
        $before = $user->refresh()->getRawOriginal();
        $this->postJson('/api/v1/auth/'.$path, ['token' => $token])->assertStatus(400)->assertJsonMissingPath('user');
        $this->unchanged($user, $before);
        $this->assertDatabaseCount('account_recovery_requests', 0);
        Http::assertNothingSent();
    }

    public static function malformedCompletion(): array
    {
        return [
            [['confirmation' => ['RECUPERAR MI CUENTA']]],
            [['confirmation' => 'otra confirmación']],
            [['token' => ['token']]],
            [['password' => ['password']]],
            [['password' => str_repeat('a', 9)]],
            [['password' => str_repeat('a', 73)]],
        ];
    }

    #[DataProvider('malformedCompletion')]
    public function test_invalid_completion_keeps_an_approved_bearer_and_credentials_unchanged(array $overrides): void
    {
        $user = User::factory()->create(['mfa_enabled' => true]);
        $before = $user->refresh()->getRawOriginal();
        $token = Ids::randomToken(32);
        $row = AccountRecoveryRequest::create([
            'user_id' => $user->id, 'security_version' => 1, 'status' => 'approved',
            'completion_token_hash' => Ids::sha256Hex($token), 'completion_expires_at' => now()->addMinutes(30), 'expires_at' => now()->addDay(),
        ]);
        foreach ([1, 2] as $index) {
            $admin = User::factory()->create(['is_admin' => true, 'mfa_enabled' => true]);
            DB::table('account_recovery_approvals')->insert([
                'request_id' => $row->id, 'admin_user_id' => $admin->id, 'reason_code' => 'identity_verified_external', 'created_at' => now(),
            ]);
        }
        $caseBefore = $row->refresh()->getRawOriginal();
        $this->postJson('/api/v1/auth/account-recovery/complete', [
            'token' => $token, 'password' => 'brujula-limonero-zafiro-93', 'confirmation' => 'RECUPERAR MI CUENTA', ...$overrides,
        ])->assertStatus(422)->assertExactJson(['error' => 'Datos de recuperación inválidos']);
        $this->unchanged($user, $before);
        $this->assertSame($caseBefore, $row->refresh()->getRawOriginal());
        $this->assertDatabaseCount('account_recovery_approvals', 2);
    }

    public function test_trimmed_case_insensitive_lookup_opens_recovery_without_authenticating(): void
    {
        $user = User::factory()->create(['email' => 'MiXeD@example.test', 'mfa_enabled' => true]);
        $before = $user->refresh()->getRawOriginal();
        $this->postJson('/api/v1/auth/account-recovery/request', ['email' => '  MIXED@EXAMPLE.TEST  ', 'captchaToken' => 'fixture'])
            ->assertStatus(202)->assertExactJson([
                'ok' => true, 'message' => 'Si la cuenta existe, está verificada y tiene MFA, recibirás un enlace para abrir el expediente.',
            ])->assertCookieMissing('uvh_session');
        $this->assertSame($before, $user->refresh()->getRawOriginal());
        $this->assertDatabaseHas('account_recovery_requests', ['user_id' => $user->id, 'status' => 'requested']);
        $this->assertDatabaseCount('mail_outbox', 1);
        $this->assertDatabaseCount('sessions', 0);
        Http::assertSentCount(1);
    }
}
