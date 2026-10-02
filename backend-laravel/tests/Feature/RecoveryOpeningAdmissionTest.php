<?php

namespace Tests\Feature;

use App\Models\AccountRecoveryRequest;
use App\Models\User;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\MailDeliveryEligibility;
use App\Support\UvhCrypto;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class RecoveryOpeningAdmissionTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, mail_outbox, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'recovery-opening')->withHeader('X-CSRF-Token', 'recovery-opening');
        Queue::fake();
    }

    private function account(): User
    {
        return User::factory()->create(['email' => 'owner@example.test', 'mfa_enabled' => true, 'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP'), 'recovery_codes' => [Ids::sha256Hex('ABCD2345EFGH6789')]])->refresh();
    }

    private function recovery(User $user): array
    {
        $token = Ids::randomToken(32);
        $row = AccountRecoveryRequest::create([
            'user_id' => $user->id, 'security_version' => (int) $user->security_version,
            'status' => 'requested', 'confirmation_token_hash' => Ids::sha256Hex($token),
            'confirmation_expires_at' => now()->addHour(), 'expires_at' => now()->addDays(7),
        ]);
        // Model timestamps are not mass assignable; age the persisted fixture
        // explicitly so refresh tests actually get past the resend cooldown.
        DB::table('account_recovery_requests')->where('id', $row->id)->update([
            'created_at' => now()->subMinutes(2), 'updated_at' => now()->subMinutes(2),
        ]);

        return [$row->refresh(), $token];
    }

    private function requestRecovery(string $email = 'owner@example.test')
    {
        return $this->postJson('/api/v1/auth/account-recovery/request', ['email' => $email, 'captchaToken' => 'fixture']);
    }

    private function confirm(string $token)
    {
        return $this->postJson('/api/v1/auth/account-recovery/confirm', ['token' => $token]);
    }

    private function failAudit(string $action): void
    {
        DB::listen(static function (QueryExecuted $query) use ($action): void {
            if (str_starts_with($query->sql, 'insert into "audit_outbox"')) {
                foreach ($query->bindings as $binding) {
                    if (is_string($binding) && str_contains($binding, '"action":"'.$action.'"')) {
                        throw new \RuntimeException('Injected recovery audit admission failure');
                    }
                }
            }
        });
    }

    public static function admissions(): array
    {
        $cases = [];
        foreach (['request', 'refresh', 'confirm'] as $operation) {
            foreach ([true, false] as $fail) {
                $cases[$operation.($fail ? ' admission' : ' history')] = [$operation, $fail];
            }
        }

        return $cases;
    }

    #[DataProvider('admissions')]
    public function test_exact_event_shares_recovery_admission(string $operation, bool $fail): void
    {
        $user = $this->account();
        $securityBefore = $user->getRawOriginal();
        [$row, $token] = $operation === 'request' ? [null, null] : $this->recovery($user);
        $before = $row?->refresh()->getRawOriginal();
        $action = $operation === 'confirm' ? 'auth.account_recovery_email_confirmed' : 'auth.account_recovery_requested';
        if ($fail) {
            $this->failAudit($action);
        } else {
            Schema::rename('audit_events', 'audit_events_recovery_opening');
        }
        try {
            $response = $operation === 'confirm' ? $this->confirm($token) : $this->requestRecovery();
            if ($operation === 'confirm') {
                $fail ? $response->assertServerError() : $response->assertOk();
            } else {
                $response->assertStatus(202)->assertJson(['ok' => true]);
            }
            $this->assertSame($securityBefore, $user->refresh()->getRawOriginal());
            $this->assertDatabaseCount('sessions', 0);
            $this->assertDatabaseCount('api_tokens', 0);
            if ($fail) {
                if ($row) {
                    $this->assertSame($before, $row->refresh()->getRawOriginal());
                } else {
                    $this->assertDatabaseCount('account_recovery_requests', 0);
                }
                $this->assertDatabaseCount('mail_outbox', 0);
                $this->assertDatabaseCount('audit_outbox', 0);
            } else {
                $saved = AccountRecoveryRequest::sole();
                $this->assertSame($operation === 'confirm' ? 'email_confirmed' : 'requested', $saved->status);
                $this->assertDatabaseCount('mail_outbox', $operation === 'confirm' ? 0 : 1);
                $event = json_decode(DB::table('audit_outbox')->sole()->event, true, flags: JSON_THROW_ON_ERROR);
                $this->assertSame($action, $event['action']);
                $this->assertSame($user->id, $event['user_id']);
                $this->assertSame((string) $saved->id, $event['resource_id']);
                foreach ([$token, 'JBSWY3DPEHPK3PXP', 'ABCD2345EFGH6789'] as $secret) {
                    if ($secret) {
                        $this->assertStringNotContainsString($secret, json_encode($event, JSON_THROW_ON_ERROR));
                    }
                }
                if ($operation === 'refresh') {
                    $this->assertNotSame($before['confirmation_token_hash'], $saved->confirmation_token_hash);
                }
            }
        } finally {
            if (! $fail) {
                Schema::rename('audit_events_recovery_opening', 'audit_events');
            }
        }
        if (! $fail) {
            $this->assertTrue(Audit::drain());
            $this->assertTrue(Audit::drain());
            $this->assertSame(1, DB::table('audit_events')->where('action', $action)->count());
        }
    }

    public function test_public_request_stays_uniform_when_audit_admission_fails(): void
    {
        config(['app.debug' => false]);
        $this->account();
        $this->failAudit('auth.account_recovery_requested');
        $eligible = $this->requestRecovery()->assertStatus(202);
        $unknown = $this->requestRecovery('unknown@example.test')->assertStatus(202);
        $this->assertSame($eligible->json(), $unknown->json());
        $this->assertDatabaseCount('account_recovery_requests', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();
    }

    public static function ineligibleAccounts(): array
    {
        return ['blocked' => ['blocked'], 'unverified' => ['unverified'], 'without MFA' => ['no-mfa']];
    }

    #[DataProvider('ineligibleAccounts')]
    public function test_public_request_does_not_reveal_ineligible_accounts(string $reason): void
    {
        $user = $this->account();
        $user->update(match ($reason) {
            'blocked' => ['deleted_at' => now()],
            'unverified' => ['email_verified_at' => null],
            'no-mfa' => ['mfa_enabled' => false],
        });
        $answer = $this->requestRecovery()->assertStatus(202);
        $unknown = $this->requestRecovery('unknown@example.test')->assertStatus(202);
        $this->assertSame($answer->json(), $unknown->json());
        $this->assertDatabaseCount('account_recovery_requests', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
    }

    public static function deadlines(): array
    {
        $cases = [];
        foreach (['confirmation_expires_at', 'expires_at'] as $column) {
            foreach ([-1, 0, 1] as $seconds) {
                $cases[$column.' '.$seconds] = [$column, $seconds];
            }
        }

        return $cases;
    }

    #[DataProvider('deadlines')]
    public function test_confirmation_rejects_the_exact_expiration_deadline(string $column, int $seconds): void
    {
        $this->freezeSecond();
        try {
            $user = $this->account();
            [$row, $token] = $this->recovery($user);
            $row->update([$column => now()->addSeconds($seconds)]);
            $response = $this->confirm($token);
            $response->assertStatus($seconds > 0 ? 200 : 400);
            $this->assertSame($seconds > 0 ? 'email_confirmed' : 'expired', $row->refresh()->status);
            $this->assertNull($row->confirmation_token_hash);
            $this->assertSame($seconds > 0, $row->email_confirmed_at !== null);
            $this->assertDatabaseCount('sessions', 0);
        } finally {
            $this->travelBack();
        }
    }

    public static function expiredCases(): array
    {
        return ['past' => [-1], 'exact deadline' => [0], 'future' => [1]];
    }

    #[DataProvider('expiredCases')]
    public function test_request_retires_expired_active_case_before_opening_another(int $seconds): void
    {
        $this->freezeSecond();
        try {
            $user = $this->account();
            [$row] = $this->recovery($user);
            $row->update(['status' => 'approved', 'completion_token_hash' => Ids::sha256Hex('completion-fixture'), 'completion_expires_at' => now()->addMinutes(30), 'expires_at' => now()->addSeconds($seconds)]);
            $this->requestRecovery()->assertStatus(202);
            $this->assertSame($seconds > 0 ? 'approved' : 'expired', $row->refresh()->status);
            $this->assertDatabaseCount('account_recovery_requests', $seconds > 0 ? 1 : 2);
            $this->assertDatabaseCount('mail_outbox', $seconds > 0 ? 0 : 1);
            if ($seconds <= 0) {
                $this->assertNull($row->confirmation_token_hash);
                $this->assertNull($row->completion_token_hash);
            }
        } finally {
            $this->travelBack();
        }
    }

    public function test_confirmation_proves_email_once_without_authenticating_or_removing_mfa(): void
    {
        $user = $this->account();
        $before = $user->getRawOriginal();
        $this->requestRecovery()->assertStatus(202);
        $mail = DB::table('mail_outbox')->sole();
        $envelope = json_decode(UvhCrypto::decryptAtRest($mail->encrypted_envelope), true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame(1, preg_match('/token=([A-Za-z0-9_-]{43})/', $envelope['text'], $match));
        $this->assertTrue(MailDeliveryEligibility::isCurrent($mail));
        $this->confirm($match[1])->assertOk()->assertJsonMissingPath('user');
        $this->confirm($match[1])->assertStatus(400);
        $this->requestRecovery()->assertStatus(202);
        $this->assertSame($before, $user->refresh()->getRawOriginal());
        $this->assertSame('email_confirmed', AccountRecoveryRequest::sole()->status);
        $this->assertFalse(MailDeliveryEligibility::isCurrent($mail));
        $this->assertDatabaseCount('mail_outbox', 1);
        $this->assertDatabaseCount('sessions', 0);
    }
}
