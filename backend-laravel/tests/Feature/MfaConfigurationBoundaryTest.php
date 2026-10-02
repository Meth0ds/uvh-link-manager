<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Models\User;
use App\Support\Ids;
use App\Support\MfaAttempts;
use App\Support\MfaInfrastructureUnavailable;
use App\Support\SessionManager;
use App\Support\Totp;
use App\Support\UvhCrypto;
use App\Support\UvhRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class MfaConfigurationBoundaryTest extends TestCase
{
    private const PASSWORD = 'brujula-limonero-zafiro-93';

    private const RECOVERY = 'ABCD2345EFGH6789';

    private const SECRET = 'JBSWY3DPEHPK3PXP';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, mail_outbox, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        Queue::fake();
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'mfa-boundary')->withHeader('X-CSRF-Token', 'mfa-boundary');
    }

    private function account(bool $active = true): User
    {
        return User::factory()->create([
            'password_hash' => Hash::make(self::PASSWORD),
            'mfa_enabled' => $active,
            'mfa_secret' => $active ? UvhCrypto::encryptAtRest(self::SECRET) : null,
            'recovery_codes' => $active ? [Ids::sha256Hex(self::RECOVERY)] : null,
            'mfa_pending_secret' => UvhCrypto::encryptAtRest(self::SECRET),
            'mfa_pending_expires_at' => now()->addMinutes(10),
        ])->refresh();
    }

    private function useSession(User $user): string
    {
        $token = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, (bool) $user->mfa_enabled);
        $this->withCookie('uvh_session', $token);

        return Ids::sha256Hex($token);
    }

    public static function actions(): array
    {
        return array_combine(['setup', 'cancel', 'enable', 'reconfigure', 'regenerate', 'disable'], array_map(fn ($value) => [$value], ['setup', 'cancel', 'enable', 'reconfigure', 'regenerate', 'disable']));
    }

    #[DataProvider('actions')]
    public function test_pre_authorized_mutations_reject_an_email_that_is_no_longer_verified(string $action): void
    {
        $user = $this->account($action !== 'enable');
        $id = $this->useSession($user);
        $snapshot = clone $user;
        $user->update(['email_verified_at' => null]);
        $before = $user->refresh()->getRawOriginal();
        $sessions = DB::table('sessions')->orderBy('id')->get()->toJson();
        $request = Request::create('/', 'POST', match ($action) {
            'setup' => ['password' => self::PASSWORD, 'code' => self::RECOVERY],
            'enable', 'reconfigure' => ['code' => Totp::currentCode(self::SECRET)],
            'regenerate' => ['password' => self::PASSWORD, 'factorCode' => self::RECOVERY],
            'disable' => ['password' => self::PASSWORD, 'code' => self::RECOVERY],
            default => [],
        });
        $request->attributes->set(UvhRequest::USER, $snapshot);
        $request->attributes->set(UvhRequest::SESSION_ID, $id);
        $method = match ($action) {
            'setup' => 'mfaSetup', 'cancel' => 'mfaCancelSetup',
            'enable', 'reconfigure' => 'mfaEnable', 'regenerate' => 'mfaRegenerateRecoveryCodes', 'disable' => 'mfaDisable',
        };
        $response = app(AuthController::class)->{$method}($request);
        $this->assertSame(409, $response->getStatusCode());
        $this->assertSame($before, $user->refresh()->getRawOriginal());
        $this->assertSame($sessions, DB::table('sessions')->orderBy('id')->get()->toJson());
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertDatabaseCount('notifications', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
        Queue::assertNothingPushed();
    }

    public static function deadlines(): array
    {
        $cases = [];
        foreach ([false, true] as $active) {
            foreach ([-1, 0, 1] as $seconds) {
                $cases[($active ? 'reconfigure' : 'enable').' '.$seconds] = [$active, $seconds];
            }
        }

        return $cases;
    }

    #[DataProvider('deadlines')]
    public function test_pending_factor_must_be_strictly_before_its_expiry(bool $active, int $seconds): void
    {
        $this->travelTo(now()->startOfSecond());
        $user = $this->account($active);
        $user->update(['mfa_pending_expires_at' => now()->addSeconds($seconds)]);
        $this->useSession($user);
        $before = $user->refresh()->getRawOriginal();
        $code = Totp::currentCode(self::SECRET);
        $response = $this->postJson('/api/v1/auth/mfa/enable', ['code' => $code]);
        $response->assertStatus($seconds > 0 ? 200 : 403);
        if ($seconds <= 0) {
            $this->assertSame($before, $user->refresh()->getRawOriginal());
            $factor = substr(hash('sha256', self::SECRET), 0, 24);
            $this->assertFalse(Cache::has('uvh:mfa:totp-used:'.$user->id.':'.$factor.':'.Totp::matchingCounter($code, self::SECRET)));
            $this->assertDatabaseCount('mail_outbox', 0);
        }
    }

    public static function setupFailures(): array
    {
        return ['first setup password' => [false, true], 'replacement password' => [true, true], 'replacement factor' => [true, false]];
    }

    #[DataProvider('setupFailures')]
    public function test_setup_attempt_budget_follows_the_account_across_sessions(bool $active, bool $wrongPassword): void
    {
        $user = $this->account($active);
        for ($attempt = 0; $attempt < MfaAttempts::LIMIT; $attempt++) {
            if ($attempt % 5 === 0) {
                $this->useSession($user);
            }
            $this->postJson('/api/v1/auth/mfa/setup', [
                'password' => $wrongPassword ? 'wrong-password' : self::PASSWORD,
                'code' => $wrongPassword ? self::RECOVERY : 'ZZZZZZZZ2222YYYY',
            ])->assertStatus(403);
        }
        $this->useSession($user);
        $before = $user->refresh()->getRawOriginal();
        $this->postJson('/api/v1/auth/mfa/setup', ['password' => self::PASSWORD, 'code' => self::RECOVERY])
            ->assertStatus(429)->assertHeader('Retry-After')->assertJsonMissingPath('secret');
        $this->assertSame($before, $user->refresh()->getRawOriginal());
    }

    public function test_enable_attempt_budget_follows_the_account_across_sessions(): void
    {
        $user = $this->account(false);
        $code = Totp::currentCode(self::SECRET);
        $bad = str_pad((string) (((int) $code + 111111) % 1000000), 6, '0', STR_PAD_LEFT);
        $this->assertNull(Totp::matchingCounter($bad, self::SECRET));
        for ($attempt = 0; $attempt < MfaAttempts::LIMIT; $attempt++) {
            if ($attempt % 5 === 0) {
                $this->useSession($user);
            }
            $this->postJson('/api/v1/auth/mfa/enable', ['code' => $bad])->assertStatus(403);
        }
        $this->useSession($user);
        $before = $user->refresh()->getRawOriginal();
        $this->postJson('/api/v1/auth/mfa/enable', ['code' => Totp::currentCode(self::SECRET)])
            ->assertStatus(429)->assertHeader('Retry-After')->assertJsonMissingPath('recoveryCodes');
        $this->assertSame($before, $user->refresh()->getRawOriginal());
    }

    public static function spentGlobalBudget(): array
    {
        return ['setup' => ['setup'], 'enable' => ['enable']];
    }

    #[DataProvider('spentGlobalBudget')]
    public function test_setup_and_enable_cannot_bypass_a_spent_budget_on_other_surfaces(string $action): void
    {
        $user = $this->account($action === 'setup');
        foreach (['totp', 'recovery'] as $purpose) {
            for ($attempt = 0; $attempt < MfaAttempts::LIMIT; $attempt++) {
                MfaAttempts::recordFailure($user->id, $purpose);
            }
        }
        $this->useSession($user);
        $before = $user->refresh()->getRawOriginal();
        $this->postJson('/api/v1/auth/mfa/'.$action, $action === 'setup'
            ? ['password' => self::PASSWORD, 'code' => self::RECOVERY]
            : ['code' => Totp::currentCode(self::SECRET)])
            ->assertStatus(429)->assertHeader('Retry-After');
        $this->assertSame($before, $user->refresh()->getRawOriginal());
        $this->assertDatabaseCount('mail_outbox', 0);
    }

    public static function legitimateSetups(): array
    {
        return ['first' => [false, false], 'replacement recovery' => [true, false], 'replacement TOTP' => [true, true]];
    }

    #[DataProvider('legitimateSetups')]
    public function test_current_proof_can_prepare_a_factor_without_replacing_the_active_one(bool $active, bool $totp): void
    {
        $user = $this->account($active);
        $id = $this->useSession($user);
        DB::table('sessions')->where('id', $id)->update(['mfa_verified_at' => $active ? now()->subMinutes(5) : null]);
        MfaAttempts::recordFailure($user->id, 'mfa-setup');
        $response = $this->postJson('/api/v1/auth/mfa/setup', [
            'password' => self::PASSWORD,
            'code' => $active ? ($totp ? Totp::currentCode(self::SECRET) : self::RECOVERY) : null,
        ])->assertOk()->assertJsonStructure(['secret', 'uri']);
        $this->assertSame($response->json('secret'), UvhCrypto::decryptAtRest($user->refresh()->mfa_pending_secret));
        $this->assertSame($active, $user->mfa_enabled);
        $this->assertSame(1, $user->security_version);
        $this->assertSame($active ? self::SECRET : null, $active ? UvhCrypto::decryptAtRest($user->mfa_secret) : $user->mfa_secret);
        $this->assertSame($active ? ($totp ? [Ids::sha256Hex(self::RECOVERY)] : []) : null, $user->recovery_codes);
        $this->assertSame(0, Cache::get('uvh:mfa:attempts:mfa-setup:'.$user->id, 0));
        $this->assertSame(0, Cache::get('uvh:mfa:attempts:global:'.$user->id, 0));
        $this->assertDatabaseCount('mail_outbox', 0);
        if ($active) {
            $this->assertTrue(Carbon::parse(DB::table('sessions')->where('id', $id)->value('mfa_verified_at'))->gt(now()->subMinute()));
        }
    }

    public function test_replacement_cannot_reuse_a_consumed_totp_to_rotate_the_pending_secret(): void
    {
        $user = $this->account();
        $this->useSession($user);
        $payload = ['password' => self::PASSWORD, 'code' => Totp::currentCode(self::SECRET)];
        $this->postJson('/api/v1/auth/mfa/setup', $payload)->assertOk();
        $before = $user->refresh()->getRawOriginal();
        $this->postJson('/api/v1/auth/mfa/setup', $payload)->assertStatus(403);
        $this->assertSame($before, $user->refresh()->getRawOriginal());
    }

    public static function parkedPasswords(): array
    {
        return ['current' => [self::PASSWORD], 'wrong' => ['wrong-password']];
    }

    #[DataProvider('parkedPasswords')]
    public function test_a_parked_replacement_cannot_probe_password_or_consume_the_factor(string $password): void
    {
        $user = $this->account();
        $id = $this->useSession($user);
        DB::table('sessions')->where('id', $id)->update(['mfa_verified_at' => now()->subHour()]);
        $before = $user->refresh()->getRawOriginal();
        $this->postJson('/api/v1/auth/mfa/setup', ['password' => $password, 'code' => self::RECOVERY])
            ->assertStatus(403)->assertJsonPath('details.reason', 'mfa_reauthentication_required');
        $this->assertSame($before, $user->refresh()->getRawOriginal());
        $this->assertFalse(MfaAttempts::tooMany($user->id, 'mfa-setup'));
        $this->assertSame(0, Cache::get('uvh:mfa:attempts:global:'.$user->id, 0));
    }

    #[DataProvider('spentGlobalBudget')]
    public function test_configuration_fails_closed_when_the_attempt_store_is_unavailable(string $action): void
    {
        $user = $this->account($action === 'setup');
        $id = $this->useSession($user);
        $before = $user->refresh()->getRawOriginal();
        $request = Request::create('/', 'POST', $action === 'setup'
            ? ['password' => self::PASSWORD, 'code' => self::RECOVERY]
            : ['code' => Totp::currentCode(self::SECRET)]);
        $request->attributes->set(UvhRequest::USER, clone $user);
        $request->attributes->set(UvhRequest::SESSION_ID, $id);
        Cache::shouldReceive('store')->andThrow(new \RuntimeException('Fixture: attempt store unavailable'));
        $caught = null;
        try {
            app(AuthController::class)->{$action === 'setup' ? 'mfaSetup' : 'mfaEnable'}($request);
        } catch (MfaInfrastructureUnavailable $error) {
            $caught = $error;
        }
        $this->assertNotNull($caught);
        $this->assertSame('MFA attempt store unavailable', $caught->getMessage());
        $this->assertSame($before, $user->refresh()->getRawOriginal());
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();
    }

    public static function protectiveClosures(): array
    {
        return ['single' => ['single'], 'others' => ['others'], 'all' => ['all']];
    }

    #[DataProvider('protectiveClosures')]
    public function test_the_verified_email_guard_does_not_prevent_protective_session_closure(string $action): void
    {
        $user = $this->account();
        $other = $this->useSession($user);
        $current = $this->useSession($user);
        $snapshot = clone $user;
        $user->update(['email_verified_at' => null]);
        $request = Request::create('/', 'POST');
        $request->attributes->set(UvhRequest::USER, $snapshot);
        $request->attributes->set(UvhRequest::SESSION_ID, $current);
        $controller = app(AuthController::class);
        $response = match ($action) {
            'single' => $controller->revokeSession($request, $other),
            'others' => $controller->revokeOtherSessions($request),
            'all' => $controller->revokeAllSessions($request),
        };
        $this->assertSame(200, $response->getStatusCode());
        $this->assertNotNull(DB::table('sessions')->where('id', $other)->value('revoked_at'));
        $this->assertSame($action === 'all', DB::table('sessions')->where('id', $current)->value('revoked_at') !== null);
    }
}
