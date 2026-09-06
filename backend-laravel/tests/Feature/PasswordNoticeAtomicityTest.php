<?php

namespace Tests\Feature;

use App\Jobs\DeliverMailOutboxJob;
use App\Models\AccountRecoveryRequest;
use App\Models\User;
use App\Support\Ids;
use App\Support\MailDeliveryEligibility;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Prepared regression contracts: run only with the isolated *_test DB guard. */
final class PasswordNoticeAtomicityTest extends TestCase
{
    private const CURRENT_PASSWORD = 'tiovivo-cobrizo-astilla-42';

    private const NEW_PASSWORD = 'brujula-limonero-zafiro-93';

    private const RECOVERY_CODE = 'ABCD2345EFGH6789';

    private bool $failNoticeInsert = false;

    /** @var list<int> */
    private array $noticeTransactionLevels = [];

    protected function setUp(): void
    {
        // The parent's database-name guard runs BEFORE any fixture truncation.
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, email_tokens, mail_outbox, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'notice-csrf')->withHeaders(['X-CSRF-Token' => 'notice-csrf']);
        Queue::fake();

        DB::listen(function (QueryExecuted $event): void {
            if (! str_starts_with(strtolower($event->sql), 'insert')
                || ! str_contains($event->sql, '"mail_outbox"')) {
                return;
            }
            $this->noticeTransactionLevels[] = $event->connection->transactionLevel();
            if ($this->failNoticeInsert) {
                // Fail AFTER the real INSERT, not before it. Both the envelope
                // and all preceding credential mutations must roll back.
                throw new \RuntimeException('Fixture: notice admission interrupted');
            }
        });
    }

    public static function credentialFlows(): array
    {
        return ['reset' => ['reset'], 'change with recovery code' => ['change'], 'dual-approved recovery' => ['recovery']];
    }

    #[DataProvider('credentialFlows')]
    public function test_failed_admission_rolls_back_credentials_and_allows_a_safe_retry(string $flow): void
    {
        $user = $this->newUser([
            'is_admin' => true,
            'mfa_enabled' => true,
            'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP'),
            'recovery_codes' => [Ids::sha256Hex(self::RECOVERY_CODE)],
        ]);
        $before = $user->only(['password_hash', 'security_version', 'is_admin', 'mfa_enabled', 'mfa_secret', 'recovery_codes']);
        $current = SessionManager::create($user->id, Request::create('/'), 1, true);
        $other = SessionManager::create($user->id, Request::create('/'), 1, true);
        $this->withCookie('uvh_session', $current);
        $reset = $this->emailToken($user, 'reset');
        $previousIncident = $this->emailToken($user, 'security_revoke');
        [$case, $completion] = $this->approvedRecovery($user);
        $workspaceId = DB::table('workspaces')->insertGetId([
            'name' => 'Fixture', 'slug' => 'notice-fixture', 'owner_user_id' => $user->id,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $apiId = DB::table('api_tokens')->insertGetId([
            'workspace_id' => $workspaceId, 'name' => 'Fixture', 'token_hash' => Ids::sha256Hex('fixture-api'),
            'scopes' => '[]', 'created_by' => $user->id, 'created_at' => now(),
        ]);
        [$url, $payload] = match ($flow) {
            'reset' => ['/api/v1/auth/reset-password', ['token' => $reset, 'password' => self::NEW_PASSWORD]],
            'change' => ['/api/v1/auth/change-password', [
                'current' => self::CURRENT_PASSWORD, 'newPassword' => self::NEW_PASSWORD, 'factorCode' => self::RECOVERY_CODE,
            ]],
            'recovery' => ['/api/v1/auth/account-recovery/complete', [
                'token' => $completion, 'password' => self::NEW_PASSWORD, 'confirmation' => 'RECUPERAR MI CUENTA',
            ]],
        };

        $this->failNoticeInsert = true;
        $this->postJson($url, $payload)->assertStatus(503);
        $this->assertSame($before, $user->refresh()->only(array_keys($before)));
        foreach ([$current, $other] as $session) {
            $this->assertDatabaseHas('sessions', ['id' => Ids::sha256Hex($session), 'security_version' => 1, 'revoked_at' => null]);
        }
        $this->assertDatabaseHas('api_tokens', ['id' => $apiId, 'revoked_at' => null]);
        $this->assertDatabaseHas('email_tokens', ['id' => Ids::sha256Hex($reset), 'used_at' => null]);
        $this->assertDatabaseHas('email_tokens', ['id' => Ids::sha256Hex($previousIncident), 'used_at' => null]);
        $this->assertDatabaseCount('email_tokens', 2);
        $this->assertDatabaseHas('account_recovery_requests', [
            'id' => $case->id, 'status' => 'approved', 'completion_token_hash' => Ids::sha256Hex($completion),
        ]);
        $this->assertSame(2, DB::table('account_recovery_approvals')->where('request_id', $case->id)->count());
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();

        // The same persisted recovery code/reset/completion bearer remains
        // usable after rollback; no token recreation is necessary to retry.
        $this->failNoticeInsert = false;
        $this->postJson($url, $payload)->assertOk();
        $this->assertTrue(Hash::check(self::NEW_PASSWORD, $user->refresh()->password_hash));
        $this->assertSame(2, $user->security_version);
        $this->assertSame([1, 1], $this->noticeTransactionLevels);
        $this->assertCurrentNotice($user);
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
        $this->assertNotNull(DB::table('sessions')->where('id', Ids::sha256Hex($other))->value('revoked_at'));
        if ($flow === 'change') {
            $this->assertDatabaseHas('sessions', ['id' => Ids::sha256Hex($current), 'security_version' => 2, 'revoked_at' => null]);
            $this->assertSame([], $user->recovery_codes);
        } else {
            $this->assertNotNull(DB::table('sessions')->where('id', Ids::sha256Hex($current))->value('revoked_at'));
            $this->assertNotNull(DB::table('api_tokens')->where('id', $apiId)->value('revoked_at'));
        }
        $this->assertSame($flow === 'recovery' ? 'completed' : 'cancelled', $case->refresh()->status);
        if ($flow === 'recovery') {
            $this->assertFalse($user->mfa_enabled);
            $this->assertFalse($user->is_admin);
            $this->assertNull($user->recovery_codes);
        }
    }

    public function test_outer_rollback_discards_notice_and_defers_queue_publication(): void
    {
        $user = $this->newUser();
        $beforeHash = $user->password_hash;
        $reset = $this->emailToken($user, 'reset');

        DB::beginTransaction();
        try {
            $this->postJson('/api/v1/auth/reset-password', ['token' => $reset, 'password' => self::NEW_PASSWORD])->assertOk();
            $this->assertDatabaseCount('mail_outbox', 1);
            Queue::assertNothingPushed();
        } finally {
            DB::rollBack();
        }

        $this->assertSame($beforeHash, $user->refresh()->password_hash);
        $this->assertSame(1, $user->security_version);
        $this->assertDatabaseHas('email_tokens', ['id' => Ids::sha256Hex($reset), 'used_at' => null]);
        $this->assertDatabaseCount('email_tokens', 1);
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();
    }

    public function test_new_incident_bearer_survives_pruning_regardless_of_prior_timestamp_order(): void
    {
        $user = $this->newUser();
        $reset = $this->emailToken($user, 'reset');
        for ($index = 0; $index < 5; $index++) {
            $prior = $this->emailToken($user, 'security_revoke');
            // Deterministic ordering, independent of random token hashes:
            // emulate older notices stamped slightly ahead by another clock.
            DB::table('email_tokens')->where('id', Ids::sha256Hex($prior))->update(['created_at' => now()->addMinute()]);
        }

        $this->postJson('/api/v1/auth/reset-password', ['token' => $reset, 'password' => self::NEW_PASSWORD])->assertOk();

        $this->assertSame(5, DB::table('email_tokens')->where('user_id', $user->id)->where('kind', 'security_revoke')->count());
        $this->assertCurrentNotice($user);
    }

    private function newUser(array $attributes = []): User
    {
        return User::factory()->create(array_merge([
            'name' => 'Notice Person', 'email' => 'notice-person@example.test',
            'password_hash' => Hash::make(self::CURRENT_PASSWORD),
        ], $attributes));
    }

    private function emailToken(User $user, string $kind): string
    {
        $plain = Ids::randomToken(32);
        DB::table('email_tokens')->insert([
            'id' => Ids::sha256Hex($plain), 'user_id' => $user->id, 'kind' => $kind,
            'expires_at' => now()->addDay(), 'created_at' => now(),
        ]);

        return $plain;
    }

    /** @return array{AccountRecoveryRequest, string} */
    private function approvedRecovery(User $user): array
    {
        $plain = Ids::randomToken(32);
        $case = AccountRecoveryRequest::create([
            'user_id' => $user->id, 'security_version' => 1, 'status' => 'approved',
            'completion_token_hash' => Ids::sha256Hex($plain), 'completion_expires_at' => now()->addMinutes(30),
            'expires_at' => now()->addDay(), 'email_confirmed_at' => now(), 'approved_at' => now(),
        ]);
        foreach (['one', 'two'] as $suffix) {
            $admin = User::factory()->create(['email' => 'approver-'.$suffix.'@example.test', 'is_admin' => true, 'mfa_enabled' => true]);
            DB::table('account_recovery_approvals')->insert([
                'request_id' => $case->id, 'admin_user_id' => $admin->id,
                'reason_code' => 'identity_verified_external', 'created_at' => now(),
            ]);
        }

        return [$case, $plain];
    }

    private function assertCurrentNotice(User $user): void
    {
        $this->assertDatabaseCount('mail_outbox', 1);
        $notice = DB::table('mail_outbox')->where('kind', 'password_changed')->first();
        $this->assertNotNull($notice);
        $this->assertTrue(MailDeliveryEligibility::isCurrent($notice));
        $this->assertDatabaseHas('email_tokens', [
            'id' => $notice->resource_id, 'user_id' => $user->id, 'kind' => 'security_revoke', 'used_at' => null,
        ]);
        $envelope = json_decode(UvhCrypto::decryptAtRest($notice->encrypted_envelope), true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame($user->email, $envelope['to']);
        $this->assertStringContainsString('/auth/security-incident#token=', $envelope['text']);
    }
}
