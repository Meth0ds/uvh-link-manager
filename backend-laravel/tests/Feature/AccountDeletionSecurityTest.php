<?php

namespace Tests\Feature;

use App\Http\Controllers\AccountController;
use App\Models\AccountDeletionRequest;
use App\Models\User;
use App\Support\AccountDeletionAudit;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\UvhRequest;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class AccountDeletionSecurityTest extends TestCase
{
    private const PASSWORD = 'deletion-fixture-password-42';

    private bool $failAudit = false;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox, mail_outbox, notifications RESTART IDENTITY CASCADE');
        Queue::fake();
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'deletion-fixture')->withHeader('X-CSRF-Token', 'deletion-fixture');
        DB::listen(function (QueryExecuted $query): void {
            if (! $this->failAudit || ! str_starts_with(strtolower($query->sql), 'insert') || ! str_contains($query->sql, '"audit_outbox"')) {
                return;
            }
            foreach ($query->bindings as $binding) {
                $event = is_string($binding) ? json_decode($binding, true) : null;
                if (is_array($event) && str_starts_with($event['action'] ?? '', 'account.deletion_')) {
                    throw new \RuntimeException('Fixture: deletion audit unavailable');
                }
            }
        });
    }

    public static function staleActors(): array
    {
        return [['expired'], ['revoked'], ['version']];
    }

    #[DataProvider('staleActors')]
    public function test_request_revalidates_the_middleware_snapshot(string $reason): void
    {
        $user = $this->account();
        $snapshot = clone $user;
        $session = DB::table('sessions')->where('user_id', $user->id)->value('id');
        if ($reason === 'version') {
            DB::table('users')->where('id', $user->id)->update(['security_version' => 2]);
            DB::table('sessions')->where('id', $session)->update(['security_version' => 2]);
        } else {
            DB::table('sessions')->where('id', $session)->update($reason === 'revoked' ? ['revoked_at' => now()] : ['expires_at' => now()->subSecond()]);
        }
        $request = Request::create('/', 'POST', $this->credentials());
        $request->attributes->set(UvhRequest::USER, $snapshot);
        $request->attributes->set(UvhRequest::SESSION_ID, $session);
        $this->assertSame(409, app(AccountController::class)->requestDeletion($request)->getStatusCode());
        $this->assertDatabaseCount('account_deletion_requests', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();
    }

    public static function criticalActions(): array
    {
        return [['request'], ['confirm']];
    }

    #[DataProvider('criticalActions')]
    public function test_request_and_confirmation_roll_back_if_exact_audit_admission_fails(string $action): void
    {
        $user = $this->account();
        $token = Ids::randomToken(32);
        $row = $action === 'confirm' ? AccountDeletionRequest::create([
            'user_id' => $user->id, 'security_version' => 1, 'status' => 'requested',
            'confirmation_token_hash' => Ids::sha256Hex($token), 'confirmation_expires_at' => now()->addHour(),
        ]) : null;
        $this->failAudit = true;
        $this->postJson('/api/v1/auth/account-deletion'.($action === 'confirm' ? '/confirm' : ''), $action === 'confirm' ? ['token' => $token] : $this->credentials())->assertServerError();
        $this->assertNull($user->refresh()->deleted_at);
        $this->assertSame(1, $user->security_version);
        $this->assertNull(DB::table('sessions')->where('user_id', $user->id)->value('revoked_at'));
        if ($row) {
            $this->assertSame('requested', $row->refresh()->status);
            $this->assertSame(Ids::sha256Hex($token), $row->confirmation_token_hash);
        } else {
            $this->assertDatabaseCount('account_deletion_requests', 0);
        }
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();
    }

    public static function protectiveFailures(): array
    {
        return [['php'], ['sql']];
    }

    #[DataProvider('protectiveFailures')]
    public function test_protective_cancellation_preserves_a_recoverable_audit_and_cannot_be_overwritten(string $failure): void
    {
        $user = $this->account();
        $user->update(['deleted_at' => now(), 'security_version' => 2]);
        $token = Ids::randomToken(32);
        $row = AccountDeletionRequest::create(['user_id' => $user->id, 'security_version' => 2, 'status' => 'scheduled',
            'cancel_token_hash' => Ids::sha256Hex($token), 'execute_after' => now()->addDay()]);
        $this->failAudit = $failure === 'php';
        if ($failure === 'sql') {
            Schema::rename('audit_outbox', 'audit_outbox_unavailable');
        }
        try {
            $this->postJson('/api/v1/auth/account-deletion/cancel', ['token' => $token])->assertOk();
            $this->assertNull($user->refresh()->deleted_at);
            $this->assertSame('cancelled', $row->refresh()->status);
            $this->assertTrue($row->cancellation_audit_pending);
            $cancelledAt = $row->cancelled_at->toIso8601String();
            $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), 3, true));
            $this->postJson('/api/v1/auth/account-deletion', $this->credentials())->assertStatus(503);
            $this->assertSame('cancelled', $row->refresh()->status);
            $this->assertSame($cancelledAt, $row->cancelled_at->toIso8601String());
        } finally {
            $this->failAudit = false;
            if ($failure === 'sql') {
                Schema::rename('audit_outbox_unavailable', 'audit_outbox');
            }
        }
        AccountDeletionAudit::reconcile();
        AccountDeletionAudit::reconcile();
        Audit::drain();
        $this->assertFalse($row->refresh()->cancellation_audit_pending);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.deletion_cancelled')->count());
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->postJson('/api/v1/auth/account-deletion/cancel', ['token' => $token])->assertStatus(400);
    }

    public function test_cancellation_with_unavailable_history_admits_once_without_leaving_a_business_marker(): void
    {
        $user = $this->account();
        $user->update(['deleted_at' => now(), 'security_version' => 2]);
        $token = Ids::randomToken(32);
        $row = AccountDeletionRequest::create(['user_id' => $user->id, 'security_version' => 2, 'status' => 'scheduled',
            'cancel_token_hash' => Ids::sha256Hex($token), 'execute_after' => now()->addDay()]);
        Schema::rename('audit_events', 'audit_events_unavailable');
        try {
            $this->postJson('/api/v1/auth/account-deletion/cancel', ['token' => $token])->assertOk();
            $this->assertFalse($row->refresh()->cancellation_audit_pending);
            $this->assertDatabaseCount('audit_outbox', 1);
        } finally {
            Schema::rename('audit_events_unavailable', 'audit_events');
        }
        AccountDeletionAudit::reconcile();
        Audit::drain();
        Audit::drain();
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.deletion_cancelled')->count());
        $this->assertDatabaseCount('audit_outbox', 0);
    }

    public function test_failure_to_clear_the_marker_discards_its_audit_savepoint_without_undoing_protection(): void
    {
        $user = $this->account();
        $user->update(['deleted_at' => now(), 'security_version' => 2]);
        $token = Ids::randomToken(32);
        $row = AccountDeletionRequest::create(['user_id' => $user->id, 'security_version' => 2, 'status' => 'scheduled',
            'cancel_token_hash' => Ids::sha256Hex($token), 'execute_after' => now()->addDay()]);
        $fail = true;
        DB::listen(static function (QueryExecuted $query) use (&$fail): void {
            if ($fail && str_starts_with(strtolower($query->sql), 'update "account_deletion_requests"')
                && str_contains($query->sql, '"cancellation_audit_pending"') && ($query->bindings[0] ?? null) === false) {
                $fail = false;
                throw new \RuntimeException('Fixture: clearing cancellation audit marker interrupted');
            }
        });
        $this->postJson('/api/v1/auth/account-deletion/cancel', ['token' => $token])->assertOk();
        $this->assertNull($user->refresh()->deleted_at);
        $this->assertTrue($row->refresh()->cancellation_audit_pending);
        $this->assertDatabaseCount('audit_outbox', 0);
        AccountDeletionAudit::reconcile();
        AccountDeletionAudit::reconcile();
        Audit::drain();
        $this->assertFalse($row->refresh()->cancellation_audit_pending);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.deletion_cancelled')->count());
    }

    private function account(): User
    {
        $user = User::factory()->create(['email_verified_at' => now(), 'password_hash' => Hash::make(self::PASSWORD)]);
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), 1, true));

        return $user;
    }

    private function credentials(): array
    {
        return ['password' => self::PASSWORD, 'confirmation' => 'ELIMINAR MI CUENTA'];
    }
}
