<?php

namespace Tests\Feature;

use App\Models\AccountRecoveryRequest;
use App\Models\User;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Characterize live authority before moving complete recovery transactions. */
final class AccountRecoveryAdmissionTest extends TestCase
{
    private const PASSWORD = 'brujula-limonero-zafiro-93';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, mail_outbox, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'recovery-admission')->withHeader('X-CSRF-Token', 'recovery-admission');
        Queue::fake();
        $this->freezeSecond();
    }

    protected function tearDown(): void
    {
        $this->travelBack();
        parent::tearDown();
    }

    private function account(array $extra = []): User
    {
        return User::factory()->create([
            'mfa_enabled' => true,
            'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP'),
            ...$extra,
        ])->refresh();
    }

    private function recovery(User $owner, string $status = 'requested'): array
    {
        $token = Ids::randomToken(32);
        $row = AccountRecoveryRequest::create([
            'user_id' => $owner->id, 'security_version' => (int) $owner->security_version, 'status' => $status,
            'confirmation_token_hash' => $status === 'requested' ? Ids::sha256Hex($token) : null,
            'confirmation_expires_at' => $status === 'requested' ? now()->addHour() : null,
            'completion_token_hash' => $status === 'approved' ? Ids::sha256Hex($token) : null,
            'completion_expires_at' => $status === 'approved' ? now()->addMinutes(30) : null,
            'expires_at' => now()->addDays(7),
        ]);
        $admins = [];
        if ($status === 'approved') {
            foreach ([1, 2] as $index) {
                $admin = $this->account(['is_admin' => true]);
                DB::table('account_recovery_approvals')->insert([
                    'request_id' => $row->id, 'admin_user_id' => $admin->id,
                    'reason_code' => 'identity_verified_external', 'created_at' => now(),
                ]);
                $admins[] = $admin;
            }
        }

        return [$row->refresh(), $token, $admins];
    }

    private function complete(string $token)
    {
        return $this->postJson('/api/v1/auth/account-recovery/complete', [
            'token' => $token, 'password' => self::PASSWORD, 'confirmation' => 'RECUPERAR MI CUENTA',
        ]);
    }

    public static function cooldowns(): array
    {
        return ['59s' => [59, false], '60s' => [60, true], '61s' => [61, true]];
    }

    #[DataProvider('cooldowns')]
    public function test_resend_cooldown_has_an_exact_boundary(int $age, bool $renewed): void
    {
        $owner = $this->account();
        [$row, $token] = $this->recovery($owner);
        DB::table('account_recovery_requests')->where('id', $row->id)->update(['updated_at' => now()->subSeconds($age)]);
        $before = $row->refresh()->getRawOriginal();
        $this->postJson('/api/v1/auth/account-recovery/request', ['email' => $owner->email, 'captchaToken' => 'fixture'])->assertStatus(202);
        $this->assertDatabaseCount('account_recovery_requests', 1);
        $this->assertSame($renewed, $row->refresh()->confirmation_token_hash !== Ids::sha256Hex($token));
        $this->assertDatabaseCount('mail_outbox', $renewed ? 1 : 0);
        if (! $renewed) {
            $this->assertSame($before, $row->getRawOriginal());
        }
        $this->assertDatabaseCount('sessions', 0);
    }

    public static function requestedAccountChanges(): array
    {
        return [['email'], ['blocked'], ['unverified'], ['no-mfa']];
    }

    #[DataProvider('requestedAccountChanges')]
    public function test_request_revalidates_the_account_after_public_lookup(string $change): void
    {
        $owner = $this->account();
        $email = $owner->email;
        $changed = false;
        DB::listen(static function (QueryExecuted $query) use ($owner, $change, &$changed): void {
            if (! $changed && str_starts_with($query->sql, 'select') && str_contains($query->sql, 'lower(email)')) {
                $changed = true;
                $owner->update(match ($change) {
                    'email' => ['email' => 'changed@example.test'], 'blocked' => ['deleted_at' => now()],
                    'unverified' => ['email_verified_at' => null], 'no-mfa' => ['mfa_enabled' => false],
                });
            }
        });
        $this->postJson('/api/v1/auth/account-recovery/request', ['email' => $email, 'captchaToken' => 'fixture'])->assertStatus(202);
        $this->assertTrue($changed);
        $this->assertDatabaseCount('account_recovery_requests', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertDatabaseCount('audit_events', 0);
        Queue::assertNothingPushed();
    }

    public static function confirmationChanges(): array
    {
        return [['hash'], ['owner'], ['status'], ['version'], ['blocked'], ['unverified'], ['no-mfa']];
    }

    #[DataProvider('confirmationChanges')]
    public function test_confirmation_does_not_adopt_changed_case_or_account_authority(string $change): void
    {
        $owner = $this->account();
        $foreign = $this->account();
        [$row, $token] = $this->recovery($owner);
        $before = $owner->getRawOriginal();
        $changed = false;
        DB::listen(static function (QueryExecuted $query) use ($row, $owner, $foreign, $change, &$changed): void {
            if (! $changed && str_starts_with($query->sql, 'select') && str_contains($query->sql, '"account_recovery_requests"') && ! str_contains($query->sql, 'for update')) {
                $changed = true;
                match ($change) {
                    'hash' => $row->update(['confirmation_token_hash' => Ids::sha256Hex('replacement')]),
                    'owner' => $row->update(['user_id' => $foreign->id]),
                    'status' => $row->update(['status' => 'cancelled']),
                    'version' => $owner->update(['security_version' => 2]),
                    'blocked' => $owner->update(['deleted_at' => now()]),
                    'unverified' => $owner->update(['email_verified_at' => null]),
                    'no-mfa' => $owner->update(['mfa_enabled' => false]),
                };
            }
        });
        $this->postJson('/api/v1/auth/account-recovery/confirm', ['token' => $token])->assertStatus(400);
        $this->assertTrue($changed);
        $this->assertNull($row->refresh()->email_confirmed_at);
        $this->assertSame($before['password_hash'], $owner->refresh()->password_hash);
        $this->assertDatabaseCount('sessions', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertDatabaseCount('audit_events', 0);
    }

    public static function completionChanges(): array
    {
        return [
            'admin loses role' => ['admin-role', 409], 'admin loses MFA' => ['admin-mfa', 409],
            'admin loses verification' => ['admin-verification', 409], 'admin blocked' => ['admin-blocked', 409],
            'approval removed' => ['approval-removed', 409], 'approval replaced' => ['approval-replaced', 409],
            'owner generation' => ['owner-version', 400], 'owner blocked' => ['owner-blocked', 400],
            'owner verification' => ['owner-verification', 400], 'owner MFA' => ['owner-mfa', 400],
            'case cancelled' => ['case-status', 400], 'case bearer replaced' => ['case-hash', 400],
            'case deadline' => ['case-expiry', 400], 'bearer deadline' => ['bearer-expiry', 400],
        ];
    }

    #[DataProvider('completionChanges')]
    public function test_completion_rechecks_live_users_case_and_approval_set(string $change, int $status): void
    {
        $owner = $this->account();
        [$row, $token, $admins] = $this->recovery($owner, 'approved');
        $replacement = $this->account(['is_admin' => true]);
        $session = SessionManager::create($owner->id, Request::create('/'), 1, true);
        $passwordBefore = $owner->password_hash;
        $changed = false;
        DB::listen(static function (QueryExecuted $query) use ($row, $owner, $admins, $replacement, $change, &$changed): void {
            if (! $changed && str_starts_with($query->sql, 'select') && str_contains($query->sql, '"account_recovery_approvals"')) {
                $changed = true;
                match ($change) {
                    'admin-role' => $admins[0]->update(['is_admin' => false]),
                    'admin-mfa' => $admins[0]->update(['mfa_enabled' => false]),
                    'admin-verification' => $admins[0]->update(['email_verified_at' => null]),
                    'admin-blocked' => $admins[0]->update(['deleted_at' => now()]),
                    'approval-removed' => DB::table('account_recovery_approvals')->where('request_id', $row->id)->where('admin_user_id', $admins[0]->id)->delete(),
                    'approval-replaced' => DB::table('account_recovery_approvals')->where('request_id', $row->id)->where('admin_user_id', $admins[0]->id)->update(['admin_user_id' => $replacement->id]),
                    'owner-version' => $owner->update(['security_version' => 2]),
                    'owner-blocked' => $owner->update(['deleted_at' => now()]),
                    'owner-verification' => $owner->update(['email_verified_at' => null]),
                    'owner-mfa' => $owner->update(['mfa_enabled' => false]),
                    'case-status' => $row->update(['status' => 'cancelled']),
                    'case-hash' => $row->update(['completion_token_hash' => Ids::sha256Hex('replacement')]),
                    'case-expiry' => $row->update(['expires_at' => now()]),
                    'bearer-expiry' => $row->update(['completion_expires_at' => now()]),
                };
            }
        });
        $this->complete($token)->assertStatus($status);
        $this->assertTrue($changed);
        $this->assertSame($passwordBefore, $owner->refresh()->password_hash);
        $this->assertDatabaseHas('sessions', ['id' => Ids::sha256Hex($session), 'revoked_at' => null]);
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertSame(0, DB::table('audit_events')->where('action', 'auth.account_recovery_completed')->count());
        if ($status === 409) {
            $this->assertSame('in_review', $row->refresh()->status);
            $this->assertNull($row->completion_token_hash);
            $this->assertNull($row->completion_expires_at);
        }
        Queue::assertNothingPushed();
    }

    public static function browserAccounts(): array
    {
        return [['owner'], ['foreign'], ['anonymous']];
    }

    #[DataProvider('browserAccounts')]
    public function test_only_the_recovered_browser_identity_loses_its_cookie(string $identity): void
    {
        $owner = $this->account();
        $foreign = $this->account();
        [$row, $token] = $this->recovery($owner, 'approved');
        $ownerSession = SessionManager::create($owner->id, Request::create('/'), 1, true);
        $foreignSession = SessionManager::create($foreign->id, Request::create('/'), 1, true);
        if ($identity !== 'anonymous') {
            $this->withCookie('uvh_session', $identity === 'owner' ? $ownerSession : $foreignSession);
        }
        $response = $this->complete($token)->assertOk();
        $cookies = collect($response->headers->getCookies())->filter(fn ($cookie) => $cookie->getName() === 'uvh_session');
        $this->assertCount($identity === 'owner' ? 1 : 0, $cookies);
        $response->assertJsonPath('current', $identity === 'owner');
        $this->assertDatabaseHas('sessions', ['id' => Ids::sha256Hex($foreignSession), 'revoked_at' => null]);
        $this->assertNotNull(DB::table('sessions')->where('id', Ids::sha256Hex($ownerSession))->value('revoked_at'));
        $this->assertSame('completed', $row->refresh()->status);
        if ($identity === 'foreign') {
            $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('user.id', $foreign->id);
        }
    }

    public function test_outer_rollback_preserves_credentials_bearer_and_defers_delivery(): void
    {
        $owner = $this->account(['is_admin' => true, 'security_version' => 9]);
        [$row, $token] = $this->recovery($owner, 'approved');
        $before = $owner->getRawOriginal();
        DB::beginTransaction();
        try {
            $this->complete($token)->assertOk();
            $this->assertSame(10, $owner->refresh()->security_version);
            $this->assertFalse($owner->mfa_enabled);
            $this->assertFalse($owner->is_admin);
            $this->assertDatabaseCount('mail_outbox', 1);
            $this->assertDatabaseCount('audit_events', 0);
            Queue::assertNothingPushed();
        } finally {
            DB::rollBack();
        }
        $this->assertSame($before, $owner->refresh()->getRawOriginal());
        $this->assertSame('approved', $row->refresh()->status);
        $this->assertSame(Ids::sha256Hex($token), $row->completion_token_hash);
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->complete($token)->assertOk();
        $this->complete($token)->assertStatus(400);
        $this->assertTrue(Hash::check(self::PASSWORD, $owner->refresh()->password_hash));
        $this->assertSame(10, $owner->security_version);
    }
}
