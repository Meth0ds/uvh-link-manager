<?php

namespace Tests\Feature;

use App\Http\Controllers\AdminController;
use App\Models\AccountRecoveryRequest;
use App\Models\User;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use App\Support\UvhRequest;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class RecoveryDecisionAdmissionTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, mail_outbox, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        Queue::fake();
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'recovery-decision')->withHeader('X-CSRF-Token', 'recovery-decision');
    }

    private function account(bool $admin = false): User
    {
        return User::factory()->create(['is_admin' => $admin, 'mfa_enabled' => true, 'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP')])->refresh();
    }

    private function recovery(User $target): AccountRecoveryRequest
    {
        return AccountRecoveryRequest::create(['user_id' => $target->id, 'security_version' => (int) $target->security_version, 'status' => 'email_confirmed', 'email_confirmed_at' => now(), 'expires_at' => now()->addDay()])->refresh();
    }

    private function approval(AccountRecoveryRequest $row, User $actor): void
    {
        DB::table('account_recovery_approvals')->insert(['request_id' => $row->id, 'admin_user_id' => $actor->id, 'reason_code' => 'identity_verified_external', 'created_at' => now()]);
    }

    private function decide(AccountRecoveryRequest $row, User $actor, string $decision = 'approve')
    {
        $token = SessionManager::create($actor->id, Request::create('/'), (int) $actor->security_version, true);
        $request = Request::create('/', 'POST', ['decision' => $decision, 'identityVerified' => true, 'reasonCode' => $decision === 'approve' ? 'identity_verified_external' : 'insufficient_evidence']);
        $request->attributes->set(UvhRequest::USER, $actor);
        $request->attributes->set(UvhRequest::SESSION_ID, Ids::sha256Hex($token));

        return app(AdminController::class)->decideAccountRecovery($request, $row->id);
    }

    public static function admissions(): array
    {
        $cases = [];
        foreach (['first', 'second', 'reject', 'stale'] as $operation) {
            foreach ([true, false] as $fail) {
                $cases[$operation.($fail ? ' admission' : ' history')] = [$operation, $fail];
            }
        }

        return $cases;
    }

    #[DataProvider('admissions')]
    public function test_decision_and_exact_event_share_the_case_transaction(string $operation, bool $fail): void
    {
        $target = $this->account();
        $actor = $this->account(true);
        $row = $this->recovery($target);
        if (in_array($operation, ['second', 'reject'], true)) {
            $this->approval($row, $this->account(true));
            $row->update(['status' => 'in_review']);
        } elseif ($operation === 'stale') {
            $row->update(['expires_at' => now()->subSecond()]);
        }
        $before = $row->refresh()->getRawOriginal();
        $approvals = DB::table('account_recovery_approvals')->orderBy('id')->get()->toJson();
        if ($fail) {
            DB::listen(static function (QueryExecuted $query): void {
                if (str_starts_with($query->sql, 'insert into "audit_outbox"')) {
                    foreach ($query->bindings as $binding) {
                        if (is_string($binding) && str_contains($binding, '"action":"admin.account_recovery_decision"')) {
                            throw new \RuntimeException('Injected decision audit admission failure');
                        }
                    }
                }
            });
        } else {
            Schema::rename('audit_events', 'audit_events_recovery_decision');
        }
        try {
            $thrown = null;
            try {
                $response = $this->decide($row, $actor, $operation === 'reject' ? 'reject' : 'approve');
            } catch (\Throwable $error) {
                $thrown = $error;
            }
            if ($fail) {
                $this->assertNotNull($thrown, 'Failed audit admission must abort the transaction, not return success.');
                $this->assertSame('Injected decision audit admission failure', $thrown->getMessage());
                $this->assertSame($before, $row->refresh()->getRawOriginal());
                $this->assertSame($approvals, DB::table('account_recovery_approvals')->orderBy('id')->get()->toJson());
                $this->assertDatabaseCount('notifications', 0);
                $this->assertDatabaseCount('mail_outbox', 0);
                $this->assertDatabaseCount('audit_outbox', 0);
                Queue::assertNothingPushed();
            } else {
                $this->assertNull($thrown);
                $this->assertSame($operation === 'stale' ? 409 : 200, $response->getStatusCode());
                $expected = match ($operation) {
                    'first' => 'in_review', 'second' => 'approved', 'reject' => 'rejected', 'stale' => 'expired'
                };
                $this->assertSame($expected, $row->refresh()->status);
                $event = json_decode(DB::table('audit_outbox')->sole()->event, true, flags: JSON_THROW_ON_ERROR);
                $this->assertSame('admin.account_recovery_decision', $event['action']);
                $this->assertSame($actor->id, $event['user_id']);
                $metadata = json_decode($event['metadata'], true, flags: JSON_THROW_ON_ERROR);
                $this->assertSame($operation === 'stale' ? 'stale' : $expected, $metadata['result']);
                $this->assertDatabaseCount('mail_outbox', in_array($operation, ['second', 'reject'], true) ? 1 : 0);
            }
        } finally {
            if (! $fail) {
                Schema::rename('audit_events_recovery_decision', 'audit_events');
            }
        }
        if (! $fail) {
            $this->assertTrue(Audit::drain());
            $this->assertTrue(Audit::drain());
            $this->assertSame(1, DB::table('audit_events')->where('action', 'admin.account_recovery_decision')->count());
        }
    }

    public static function staleTargets(): array
    {
        $cases = [];
        foreach (['blocked', 'unverified', 'no-mfa', 'version'] as $reason) {
            foreach (['approve', 'reject'] as $decision) {
                $cases[$reason.' '.$decision] = [$reason, $decision];
            }
        }

        return $cases;
    }

    #[DataProvider('staleTargets')]
    public function test_decision_does_not_advance_an_ineligible_target(string $reason, string $decision): void
    {
        $target = $this->account();
        $actor = $this->account(true);
        $row = $this->recovery($target);
        $target->update(match ($reason) {
            'blocked' => ['deleted_at' => now()], 'unverified' => ['email_verified_at' => null], 'no-mfa' => ['mfa_enabled' => false], 'version' => ['security_version' => 2]
        });
        $before = $target->refresh()->getRawOriginal();
        $response = $this->decide($row, $actor, $decision);
        $this->assertSame(409, $response->getStatusCode());
        $this->assertSame($before, $target->refresh()->getRawOriginal());
        $this->assertSame('expired', $row->refresh()->status);
        $this->assertDatabaseCount('account_recovery_approvals', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertDatabaseCount('notifications', 0);
    }

    public function test_stored_self_approval_does_not_count_toward_a_second_admin(): void
    {
        // Defensive legacy/manual state: the decision endpoint already refuses
        // self-approval, but the table permits a pre-existing owner row.
        $target = $this->account(true);
        $actor = $this->account(true);
        $row = $this->recovery($target);
        $this->approval($row, $target);
        $response = $this->decide($row, $actor);
        $body = json_decode($response->getContent(), true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(1, $body['approvalCount']);
        $this->assertSame('in_review', $row->refresh()->status);
        $this->assertNull($row->completion_token_hash);
        $this->assertDatabaseCount('mail_outbox', 0);
    }

    public function test_case_list_reports_only_independent_current_approvals(): void
    {
        $target = $this->account(true);
        $row = $this->recovery($target);
        $this->approval($row, $target);
        $this->approval($row, $this->account(true));
        $blocked = $this->account(true);
        $blocked->update(['deleted_at' => now()]);
        $this->approval($row, $blocked);
        $response = app(AdminController::class)->accountRecoveries(Request::create('/'));
        $body = json_decode($response->getContent(), true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(1, $body['recoveries'][0]['approvalCount']);
        $this->assertArrayNotHasKey('confirmation_token_hash', $body['recoveries'][0]);
        $this->assertArrayNotHasKey('completion_token_hash', $body['recoveries'][0]);
    }

    public static function independentApprovals(): array
    {
        return ['owner and one admin' => [1], 'owner and two admins' => [2]];
    }

    #[DataProvider('independentApprovals')]
    public function test_completion_requires_two_admins_independent_of_the_owner(int $others): void
    {
        $target = $this->account(true);
        $row = $this->recovery($target);
        $token = Ids::randomToken(32);
        $row->update(['status' => 'approved', 'completion_token_hash' => Ids::sha256Hex($token), 'completion_expires_at' => now()->addMinutes(30)]);
        $this->approval($row, $target);
        for ($index = 0; $index < $others; $index++) {
            $this->approval($row, $this->account(true));
        }
        $before = $target->refresh()->getRawOriginal();
        $response = $this->postJson('/api/v1/auth/account-recovery/complete', ['token' => $token, 'password' => 'brujula-limonero-zafiro-93', 'confirmation' => 'RECUPERAR MI CUENTA']);
        $response->assertStatus($others === 2 ? 200 : 409);
        if ($others === 1) {
            $this->assertSame($before, $target->refresh()->getRawOriginal());
            $this->assertSame('in_review', $row->refresh()->status);
            $this->assertNull($row->completion_token_hash);
            $this->assertDatabaseCount('mail_outbox', 0);
        }
    }
}
