<?php

namespace Tests\Feature;

use App\Http\Controllers\AdminController;
use App\Models\AccountRecoveryRequest;
use App\Models\User;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use App\Support\UvhRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class RecoveryDeadlineTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, mail_outbox, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'recovery-deadline')->withHeader('X-CSRF-Token', 'recovery-deadline');
        Queue::fake();
        $this->freezeSecond();
    }

    protected function tearDown(): void
    {
        $this->travelBack();
        parent::tearDown();
    }

    private function account(bool $admin = false): User
    {
        return User::factory()->create(['is_admin' => $admin, 'mfa_enabled' => true, 'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP')])->refresh();
    }

    private function recovery(User $owner, string $status): array
    {
        $token = Ids::randomToken(32);
        $row = AccountRecoveryRequest::create([
            'user_id' => $owner->id, 'security_version' => (int) $owner->security_version,
            'status' => $status, 'completion_token_hash' => $status === 'approved' ? Ids::sha256Hex($token) : null,
            'completion_expires_at' => $status === 'approved' ? now()->addMinutes(30) : null,
            'email_confirmed_at' => now(), 'expires_at' => now()->addDays(7),
        ]);

        return [$row, $token];
    }

    public static function completionDeadlines(): array
    {
        $cases = [];
        foreach (['completion_expires_at', 'expires_at'] as $column) {
            foreach ([-1, 0, 1] as $seconds) {
                $cases[$column.' '.$seconds] = [$column, $seconds];
            }
        }

        return $cases;
    }

    #[DataProvider('completionDeadlines')]
    public function test_completion_obeys_both_deadlines_without_spending_credentials_after_expiry(string $column, int $seconds): void
    {
        $owner = $this->account();
        [$row, $token] = $this->recovery($owner, 'approved');
        foreach ([1, 2] as $index) {
            $admin = $this->account(true);
            DB::table('account_recovery_approvals')->insert(['request_id' => $row->id, 'admin_user_id' => $admin->id, 'reason_code' => 'identity_verified_external', 'created_at' => now()]);
        }
        $session = SessionManager::create($owner->id, Request::create('/'), 1, true);
        $before = $owner->refresh()->getRawOriginal();
        $row->update([$column => now()->addSeconds($seconds)]);
        $response = $this->postJson('/api/v1/auth/account-recovery/complete', ['token' => $token, 'password' => 'brujula-limonero-zafiro-93', 'confirmation' => 'RECUPERAR MI CUENTA']);
        $response->assertStatus($seconds > 0 ? 200 : 400);
        if ($seconds <= 0) {
            $this->assertSame($before, $owner->refresh()->getRawOriginal());
            $this->assertDatabaseHas('sessions', ['id' => Ids::sha256Hex($session), 'revoked_at' => null]);
            $this->assertDatabaseCount('mail_outbox', 0);
            $this->assertSame('expired', $row->refresh()->status);
            $this->assertNull($row->completion_token_hash);
        } else {
            $this->assertTrue(Hash::check('brujula-limonero-zafiro-93', $owner->refresh()->password_hash));
            $this->assertFalse($owner->mfa_enabled);
            $this->assertSame(2, (int) $owner->security_version);
            $this->assertNotNull(DB::table('sessions')->where('id', Ids::sha256Hex($session))->value('revoked_at'));
            $this->assertSame('completed', $row->refresh()->status);
        }
    }

    public static function adminDeadlines(): array
    {
        $cases = [];
        foreach (['case', 'session'] as $resource) {
            foreach ([-1, 0, 1] as $seconds) {
                $cases[$resource.' '.$seconds] = [$resource, $seconds];
            }
        }

        return $cases;
    }

    #[DataProvider('adminDeadlines')]
    public function test_pre_authorized_admin_decision_obeys_case_and_session_deadlines(string $resource, int $seconds): void
    {
        $owner = $this->account();
        [$row] = $this->recovery($owner, 'email_confirmed');
        $actor = $this->account(true);
        $session = SessionManager::create($actor->id, Request::create('/'), (int) $actor->security_version, true);
        if ($resource === 'case') {
            $row->update(['expires_at' => now()->addSeconds($seconds)]);
        } else {
            DB::table('sessions')->where('id', Ids::sha256Hex($session))->update(['expires_at' => now()->addSeconds($seconds)]);
        }
        $request = Request::create('/', 'POST', ['decision' => 'approve', 'identityVerified' => true, 'reasonCode' => 'identity_verified_external']);
        $request->attributes->set(UvhRequest::USER, $actor);
        $request->attributes->set(UvhRequest::SESSION_ID, Ids::sha256Hex($session));
        $response = app(AdminController::class)->decideAccountRecovery($request, $row->id);
        $this->assertSame($seconds > 0 ? 200 : 409, $response->getStatusCode());
        $this->assertDatabaseCount('account_recovery_approvals', $seconds > 0 ? 1 : 0);
        $this->assertSame($seconds > 0 ? 'in_review' : ($resource === 'case' ? 'expired' : 'email_confirmed'), $row->refresh()->status);
        $this->assertTrue($owner->refresh()->mfa_enabled);
        $this->assertSame(1, (int) $owner->security_version);
        $this->assertDatabaseCount('mail_outbox', 0);
    }
}
