<?php

namespace Tests\Feature;

use App\Models\EmailChangeRequest;
use App\Models\PendingRegistration;
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

final class EmailChangeAdmissionTest extends TestCase
{
    private const PASSWORD = 'tiovivo-cobrizo-astilla-42';

    private const CODE = 'ABCD2345EFGH6789';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, pending_registrations, mail_outbox, audit_events, audit_outbox, operational_metrics RESTART IDENTITY CASCADE');
        Queue::fake();
        $this->travelTo(now()->startOfSecond());
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'email-admission')->withHeader('X-CSRF-Token', 'email-admission');
    }

    private function owner(): User
    {
        return User::factory()->create(['email' => 'email-admission-owner@example.test', 'password_hash' => Hash::make(self::PASSWORD),
            'mfa_enabled' => true, 'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP'),
            'recovery_codes' => [Ids::sha256Hex(self::CODE)]])->refresh();
    }

    private function useSession(User $owner): void
    {
        $this->withCookie('uvh_session', SessionManager::create($owner->id, Request::create('/'), 1, true));
    }

    private function reservation(User $owner, string $target): array
    {
        $token = Ids::randomToken(32);
        $row = EmailChangeRequest::create(['id' => Ids::sha256Hex($token), 'user_id' => $owner->id,
            'new_email' => $target, 'security_version' => 1, 'expires_at' => now()->addHour(), 'created_at' => now()]);

        return [$row->refresh(), $token];
    }

    public static function expiryOffsets(): array
    {
        return [[-1], [0], [1]];
    }

    #[DataProvider('expiryOffsets')]
    public function test_only_expired_foreign_reservations_can_be_reclaimed(int $offset): void
    {
        $owner = $this->owner();
        $this->useSession($owner);
        DB::table('sessions')->where('user_id', $owner->id)->update(['mfa_verified_at' => now()->subSeconds(10)]);
        $sessionBefore = DB::table('sessions')->where('user_id', $owner->id)->value('mfa_verified_at');
        [$old] = $this->reservation($owner, 'old-destination@example.test');
        $foreign = User::factory()->create();
        [$occupied] = $this->reservation($foreign, 'destination@example.test');
        $occupied->update(['expires_at' => now()->addSeconds($offset)]);
        $before = $old->getRawOriginal();
        $response = $this->postJson('/api/v1/auth/change-email', ['newEmail' => 'destination@example.test', 'password' => self::PASSWORD, 'factorCode' => self::CODE]);
        if ($offset > 0) {
            $response->assertStatus(409)->assertExactJson(['error' => 'Ese email ya está en uso o pendiente de confirmación']);
            $this->assertSame($before, $old->refresh()->getRawOriginal());
            $this->assertNotNull($occupied->fresh());
            $this->assertSame([Ids::sha256Hex(self::CODE)], $owner->refresh()->recovery_codes);
            $this->assertSame($sessionBefore, DB::table('sessions')->where('user_id', $owner->id)->value('mfa_verified_at'));
            $this->assertDatabaseCount('mail_outbox', 0);
        } else {
            $response->assertOk();
            $this->assertNull($old->fresh());
            $this->assertNull($occupied->fresh());
            $this->assertSame('destination@example.test', EmailChangeRequest::where('user_id', $owner->id)->sole()->new_email);
            $this->assertSame([], $owner->refresh()->recovery_codes);
            $this->assertDatabaseCount('mail_outbox', 2);
        }
    }

    public static function pending(): array
    {
        return [[false], [true]];
    }

    #[DataProvider('pending')]
    public function test_cancel_preserves_its_step_up_and_audit_policy_with_or_without_pending(bool $pending): void
    {
        $owner = $this->owner();
        $this->useSession($owner);
        if ($pending) {
            $this->reservation($owner, 'cancelled-target@example.test');
        }
        $this->postJson('/api/v1/auth/change-email/cancel', ['password' => self::PASSWORD, 'factorCode' => self::CODE])->assertOk();
        $this->assertSame([], $owner->refresh()->recovery_codes);
        $this->assertDatabaseCount('email_change_requests', 0);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'auth.email_change_cancelled')->count());
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertSame(1, $owner->security_version);
    }

    public static function confirmChanges(): array
    {
        return [['expired'], ['expiry_equal'], ['blocked'], ['version'], ['unverified'], ['owner'], ['token']];
    }

    #[DataProvider('confirmChanges')]
    public function test_confirmation_rechecks_case_and_owner_after_public_lookup(string $change): void
    {
        $owner = $this->owner();
        $foreign = User::factory()->create();
        [$row, $token] = $this->reservation($owner, 'confirmed-target@example.test');
        $changed = false;
        DB::listen(static function (QueryExecuted $query) use ($change, $owner, $foreign, $row, &$changed): void {
            if ($changed || ! str_starts_with($query->sql, 'select')
                || ! str_contains($query->sql, '"email_change_requests"') || str_contains($query->sql, 'for update')) {
                return;
            }
            $changed = true;
            if (in_array($change, ['blocked', 'version', 'unverified'], true)) {
                DB::table('users')->where('id', $owner->id)->update(match ($change) {
                    'blocked' => ['deleted_at' => now()], 'version' => ['security_version' => 2],
                    default => ['email_verified_at' => null],
                });
            } else {
                DB::table('email_change_requests')->where('id', $row->id)->update(match ($change) {
                    'expired' => ['expires_at' => now()->subSecond()], 'expiry_equal' => ['expires_at' => now()],
                    'owner' => ['user_id' => $foreign->id], default => ['id' => Ids::sha256Hex('changed-confirmation-case')],
                });
            }
        });
        $this->postJson('/api/v1/auth/confirm-email-change', ['token' => $token])->assertStatus(400);
        $this->assertTrue($changed);
        $this->assertSame('email-admission-owner@example.test', $owner->refresh()->email);
        $this->assertDatabaseCount('email_change_requests', in_array($change, ['owner', 'token'], true) ? 1 : 0);
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertSame(0, DB::table('audit_events')->where('action', 'auth.email_change_confirmed')->count());
    }

    #[DataProvider('pending')]
    public function test_confirmation_refuses_a_live_user_or_pending_registration_claim(bool $pending): void
    {
        $owner = $this->owner();
        [$row, $token] = $this->reservation($owner, 'claimed@example.test');
        if ($pending) {
            PendingRegistration::create(['email' => 'claimed@example.test', 'security_version' => 1]);
        } else {
            User::factory()->create(['email' => 'claimed@example.test']);
        }
        $this->postJson('/api/v1/auth/confirm-email-change', ['token' => $token])->assertStatus(409);
        $this->assertNull($row->fresh());
        $this->assertSame('email-admission-owner@example.test', $owner->refresh()->email);
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->postJson('/api/v1/auth/confirm-email-change', ['token' => $token])->assertStatus(400);
    }

    public static function outerTransactions(): array
    {
        $cases = [];
        foreach (['request', 'cancel', 'confirm'] as $flow) {
            foreach ([false, true] as $commit) {
                $cases[$flow.($commit ? ' commit' : ' rollback')] = [$flow, $commit];
            }
        }

        return $cases;
    }

    #[DataProvider('outerTransactions')]
    public function test_outer_transaction_owns_reservation_credential_mail_and_exact_audit(string $flow, bool $commit): void
    {
        $owner = $this->owner();
        $this->useSession($owner);
        [$old, $token] = $this->reservation($owner, 'target@example.test');
        $beforeUser = $owner->getRawOriginal();
        $beforeRow = $old->getRawOriginal();
        [$url, $payload, $action] = match ($flow) {
            'request' => ['/api/v1/auth/change-email', ['newEmail' => 'next@example.test', 'password' => self::PASSWORD, 'factorCode' => self::CODE], 'auth.email_change_requested'],
            'cancel' => ['/api/v1/auth/change-email/cancel', ['password' => self::PASSWORD, 'factorCode' => self::CODE], 'auth.email_change_cancelled'],
            default => ['/api/v1/auth/confirm-email-change', ['token' => $token], 'auth.email_change_confirmed'],
        };
        DB::beginTransaction();
        try {
            $this->postJson($url, $payload)->assertOk();
            $this->assertDatabaseCount('mail_outbox', $flow === 'cancel' ? 0 : 2);
            $this->assertDatabaseCount('audit_outbox', 1);
            $this->assertDatabaseCount('audit_events', 0);
            Queue::assertNothingPushed();
            if ($commit) {
                DB::commit();
            } else {
                DB::rollBack();
            }
        } finally {
            while (DB::transactionLevel() > 0) {
                DB::rollBack();
            }
        }
        if (! $commit) {
            $this->assertSame($beforeUser, $owner->refresh()->getRawOriginal());
            $this->assertSame($beforeRow, $old->refresh()->getRawOriginal());
            $this->assertDatabaseCount('mail_outbox', 0);
            $this->assertDatabaseCount('audit_outbox', 0);
            Queue::assertNothingPushed();
            $this->postJson($url, $payload)->assertOk();
        }
        $this->assertDatabaseCount('mail_outbox', $flow === 'cancel' ? 0 : 2);
        $this->assertSame(1, DB::table('audit_events')->where('action', $action)->count());
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertSame($flow === 'confirm' ? 2 : 1, $owner->refresh()->security_version);
        $this->assertSame($flow === 'confirm' ? 'target@example.test' : 'email-admission-owner@example.test', $owner->email);
    }

    #[DataProvider('pending')]
    public function test_reservation_occupancy_is_not_revealed_before_a_valid_factor(bool $occupied): void
    {
        $owner = $this->owner();
        $this->useSession($owner);
        [$old] = $this->reservation($owner, 'old-destination@example.test');
        $before = $old->getRawOriginal();
        if ($occupied) {
            $this->reservation(User::factory()->create(), 'destination@example.test');
        }
        $this->postJson('/api/v1/auth/change-email', ['newEmail' => 'destination@example.test',
            'password' => self::PASSWORD, 'factorCode' => 'ZZZZ2345EFGH6789'])
            ->assertStatus(403)->assertExactJson(['error' => 'El código de autenticación o recuperación es incorrecto']);
        $this->assertSame($before, $old->refresh()->getRawOriginal());
        $this->assertSame([Ids::sha256Hex(self::CODE)], $owner->refresh()->recovery_codes);
        $this->assertDatabaseCount('mail_outbox', 0);
    }
}
