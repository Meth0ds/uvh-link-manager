<?php

namespace Tests\Feature;

use App\Models\Invitation;
use App\Models\User;
use App\Support\InvitationBudgetExceeded;
use App\Support\InvitationMailBudget;
use App\Support\SessionManager;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Prepared only: requires migrated *_test; no delivery or external cache used. */
final class InvitationMailBudgetTest extends TestCase
{
    private bool $breakBudgetSql = false;

    private bool $breakOutbox = false;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, mail_outbox, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        config(['uvh.secret_previous' => []]);
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'mail-budget-csrf')->withHeader('X-CSRF-Token', 'mail-budget-csrf');
        Queue::fake();
        DB::listen(function (QueryExecuted $event): void {
            if (! str_starts_with(strtolower($event->sql), 'insert')) {
                return;
            }
            if ($this->breakBudgetSql && str_contains($event->sql, '"invitation_mail_budgets"')) {
                // A real PostgreSQL statement error poisons this transaction;
                // the controller must roll back, not catch-and-continue inside it.
                $event->connection->select('SELECT 1 / 0');
            }
            if ($this->breakOutbox && str_contains($event->sql, '"mail_outbox"')) {
                throw new \RuntimeException('Fixture: outbox failed after budget reservation');
            }
        });
    }

    public static function dimensions(): array
    {
        return [
            'actor' => ['actor_day', [1, 2, 'other@example.test', '192.0.2.2']],
            'workspace' => ['workspace_day', [2, 1, 'other@example.test', '192.0.2.2']],
            'recipient normalized' => ['recipient_day', [2, 2, ' SHARED@EXAMPLE.TEST ', '192.0.2.2']],
            'IP canonical' => ['ip_day', [2, 2, 'other@example.test', '::ffff:192.0.2.1']],
            'aggregate' => ['global_day', [2, 2, 'other@example.test', '192.0.2.2']],
            'cooldown' => ['recipient_cooldown', [2, 2, 'shared@example.test', '192.0.2.2']],
        ];
    }

    #[DataProvider('dimensions')]
    public function test_each_dimension_is_shared_and_rejection_rolls_back_all_other_reservations(string $scope, array $next): void
    {
        // Isolate one dimension, without zero/disabled limits in any other.
        foreach (['actor_day', 'workspace_day', 'recipient_day', 'ip_day', 'global_day', 'recipient_cooldown'] as $key) {
            config(['uvh.invitation_mail_budget.'.$key => $key === $scope ? 1 : 100000]);
        }
        DB::transaction(fn () => InvitationMailBudget::reserve(1, 1, 'shared@example.test', '192.0.2.1'));
        $before = $this->budgets();
        $this->assertCount(6, $before);
        $error = $this->denied($next);
        $this->assertGreaterThanOrEqual(1, $error->retryAfter);
        $this->assertLessThanOrEqual($scope === 'recipient_cooldown' ? 60 : 86400, $error->retryAfter);
        $this->assertEquals($before, $this->budgets());
    }

    public function test_resend_uses_saved_recipient_and_cannot_spoof_a_fresh_budget(): void
    {
        [, $workspace] = $this->fixture();
        $url = '/api/v1/workspaces/'.$workspace->id.'/invitations';
        $this->postJson($url, ['email' => 'shared@example.test', 'role' => 'viewer'])->assertStatus(201);
        $invitation = Invitation::first();
        $token = $invitation->token;
        $before = $this->budgets();
        $this->postJson($url.'/'.$invitation->id.'/resend', ['email' => 'spoofed@example.test'])
            ->assertStatus(429)->assertHeader('Retry-After');
        $this->assertSame($token, $invitation->refresh()->token);
        $this->assertEquals($before, $this->budgets());
        $this->assertDatabaseCount('mail_outbox', 1);
        $this->assertDatabaseHas('operational_metrics', ['metric' => 'invitation.budget_rejected', 'count' => 1]);

        // A different authorized sender/workspace still shares this recipient.
        [, $otherWorkspace] = $this->fixture();
        $this->postJson('/api/v1/workspaces/'.$otherWorkspace->id.'/invitations', ['email' => 'SHARED@example.test', 'role' => 'viewer'])->assertStatus(429);
        $this->assertEquals($before, $this->budgets());
        $this->assertDatabaseCount('invitations', 1);
    }

    public static function failures(): array
    {
        return ['database failure' => [true], 'outbox failure' => [false]];
    }

    #[DataProvider('failures')]
    public function test_failed_admission_spends_no_budget_and_same_request_can_retry(bool $sql): void
    {
        [, $workspace] = $this->fixture();
        $this->breakBudgetSql = $sql;
        $this->breakOutbox = ! $sql;
        $url = '/api/v1/workspaces/'.$workspace->id.'/invitations';
        $payload = ['email' => 'retry@example.test', 'role' => 'viewer'];
        $this->postJson($url, $payload)->assertStatus(503);
        $this->assertDatabaseCount('invitation_mail_budgets', 0);
        $this->assertDatabaseCount('invitations', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();
        if ($sql) {
            $this->assertDatabaseHas('operational_metrics', ['metric' => 'invitation.budget_unavailable', 'count' => 1]);
        }
        $this->breakBudgetSql = $this->breakOutbox = false;
        $this->postJson($url, $payload)->assertStatus(201);
        $this->assertSame(6, (int) DB::table('invitation_mail_budgets')->sum('used'));
    }

    public function test_unauthorized_sender_cannot_spend_a_victims_budget(): void
    {
        [, $workspace] = $this->fixture();
        $outsider = User::factory()->create();
        $this->withCookie('uvh_session', SessionManager::create($outsider->id, Request::create('/'), 1));
        $this->postJson('/api/v1/workspaces/'.$workspace->id.'/invitations', ['email' => 'victim@example.test', 'role' => 'viewer'])->assertForbidden();
        $this->assertDatabaseCount('invitation_mail_budgets', 0);
    }

    public function test_invalid_policy_is_not_treated_as_unlimited(): void
    {
        [, $workspace] = $this->fixture();
        config(['uvh.invitation_mail_budget.global_day' => 0]);
        $this->postJson('/api/v1/workspaces/'.$workspace->id.'/invitations', ['email' => 'policy@example.test', 'role' => 'viewer'])->assertStatus(503);
        $this->assertDatabaseCount('invitation_mail_budgets', 0);
        $this->assertDatabaseCount('invitations', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();
    }

    public function test_rotation_does_not_reset_an_exhausted_shared_budget(): void
    {
        $old = str_repeat('a', 48);
        config(['uvh.secret' => $old, 'uvh.invitation_mail_budget.global_day' => 1]);
        DB::transaction(fn () => InvitationMailBudget::reserve(1, 1, 'first@example.test', '192.0.2.1'));
        $before = $this->budgets();
        config(['uvh.secret' => str_repeat('b', 48), 'uvh.secret_previous' => [$old]]);
        $this->denied([2, 2, 'second@example.test', '192.0.2.2']);
        $this->assertEquals($before, $this->budgets());
    }

    public function test_expired_windows_reset_and_purge_preserves_active_and_recent_rows(): void
    {
        DB::transaction(fn () => InvitationMailBudget::reserve(1, 1, 'first@example.test', null));
        DB::table('invitation_mail_budgets')->update(['expires_at_epoch' => 0]);
        DB::transaction(fn () => InvitationMailBudget::reserve(1, 1, 'first@example.test', null));
        $this->assertSame(6, (int) DB::table('invitation_mail_budgets')->sum('used'));
        $epoch = (int) DB::selectOne('SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp()))::bigint AS epoch')->epoch;
        DB::table('invitation_mail_budgets')->insert([
            ['budget_key' => str_repeat('c', 64), 'used' => 1, 'expires_at_epoch' => $epoch - 86410],
            ['budget_key' => str_repeat('d', 64), 'used' => 1, 'expires_at_epoch' => $epoch - 10],
        ]);
        $this->assertSame(1, InvitationMailBudget::purgeExpired());
        $this->assertDatabaseCount('invitation_mail_budgets', 7);
        $this->assertDatabaseHas('invitation_mail_budgets', ['budget_key' => str_repeat('d', 64)]);
    }

    private function denied(array $arguments): InvitationBudgetExceeded
    {
        try {
            DB::transaction(fn () => InvitationMailBudget::reserve(...$arguments));
        } catch (InvitationBudgetExceeded $error) {
            return $error;
        }
        $this->fail('Expected a transactional budget rejection');
    }

    private function budgets(): array
    {
        return DB::table('invitation_mail_budgets')->orderBy('budget_key')->get()->toArray();
    }

    private function fixture(): array
    {
        $owner = User::factory()->create();
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Mail budget fixture', 'slug' => 'budget-'.$owner->id]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $this->withCookie('uvh_session', SessionManager::create($owner->id, Request::create('/'), 1));

        return [$owner, $workspace];
    }
}
