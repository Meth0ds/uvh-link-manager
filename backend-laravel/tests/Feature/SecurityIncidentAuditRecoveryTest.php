<?php

namespace Tests\Feature;

use App\Http\Controllers\OperationsController;
use App\Models\EmailToken;
use App\Models\User;
use App\Support\Audit;
use App\Support\Auth\SecurityIncidentAudit;
use App\Support\Ids;
use App\Support\IsoDate;
use App\Support\SessionManager;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\Console\Output\BufferedOutput;
use Symfony\Component\Process\Process;
use Tests\TestCase;

final class SecurityIncidentAuditRecoveryTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, email_tokens, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        Queue::fake();
        Cache::put('uvh:housekeeping:last_heavy', (int) floor(microtime(true) * 1000));
        $this->travelTo(now()->startOfSecond());
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'incident-audit')->withHeader('X-CSRF-Token', 'incident-audit');
    }

    public static function failedAdmissions(): array
    {
        return [
            'active SQL' => ['sql', false], 'active PHP after insert' => ['php', false],
            'blocked SQL' => ['sql', true], 'blocked PHP after insert' => ['php', true],
        ];
    }

    #[DataProvider('failedAdmissions')]
    public function test_protection_commits_and_housekeeping_recovers_the_exact_event_once(string $failure, bool $blocked): void
    {
        $user = User::factory()->create(['deleted_at' => $blocked ? now() : null]);
        $identity = array_intersect_key($user->refresh()->getRawOriginal(), array_flip(['email', 'password_hash', 'mfa_enabled', 'mfa_secret', 'recovery_codes', 'deleted_at']));
        $session = SessionManager::create($user->id, Request::create('/'), 1);
        $plain = Ids::randomToken(32);
        EmailToken::create(['id' => Ids::sha256Hex($plain), 'user_id' => $user->id, 'kind' => 'security_revoke', 'expires_at' => now()->addHour()]);
        $fail = true;
        $attempted = false;
        $trace = str_repeat('a', 32);
        $this->withServerVariables(['UVH_REQUEST_ID' => $trace]);
        $incidentAt = IsoDate::format(now());
        if ($failure === 'sql') {
            Schema::rename('audit_outbox', 'audit_outbox_unavailable');
        } else {
            DB::listen(static function (QueryExecuted $query) use (&$fail, &$attempted): void {
                if (! $fail || ! str_starts_with($query->sql, 'insert into "audit_outbox"')) {
                    return;
                }
                foreach ($query->bindings as $binding) {
                    if (is_string($binding) && str_contains($binding, '"action":"auth.emergency_access_revoked"')) {
                        $attempted = true;
                        throw new \RuntimeException('Fixture: protective incident audit admission interrupted');
                    }
                }
            });
        }
        try {
            $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $plain])
                ->assertOk()->assertJsonPath('current', false);
            $this->assertSame($identity, array_intersect_key($user->refresh()->getRawOriginal(), $identity));
            $this->assertSame($blocked ? 1 : 2, (int) $user->security_version);
            $this->assertSame(! $blocked, DB::table('sessions')->where('id', Ids::sha256Hex($session))->value('revoked_at') !== null);
            $this->assertNotNull(EmailToken::findOrFail(Ids::sha256Hex($plain))->used_at);
            $this->assertSame(0, DB::table('audit_events')->where('action', 'auth.emergency_access_revoked')->count());
            if ($failure === 'php') {
                $this->assertTrue($attempted, 'The fault must follow the real exact-event INSERT.');
                $this->assertDatabaseCount('audit_outbox', 0);
            }
        } finally {
            $fail = false;
            if ($failure === 'sql') {
                Schema::rename('audit_outbox_unavailable', 'audit_outbox');
            }
        }
        $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $plain])->assertStatus(400);
        $this->assertSame(0, Artisan::call('uvh:housekeeping'));
        $this->assertSame(0, Artisan::call('uvh:housekeeping'));
        $this->assertSame(1, DB::table('audit_events')->where('action', 'auth.emergency_access_revoked')->count());
        $event = DB::table('audit_events')->where('action', 'auth.emergency_access_revoked')->first();
        $this->assertSame($user->id, (int) $event->user_id);
        $this->assertSame((string) $user->id, $event->resource_id);
        $this->assertSame($blocked, json_decode($event->metadata, true, flags: JSON_THROW_ON_ERROR)['administratively_blocked']);
        $metadata = json_decode($event->metadata, true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame($trace, $metadata['incident_correlation_id']);
        $this->assertSame($incidentAt, $metadata['incident_at']);
        $this->assertDatabaseCount('security_incident_audits', 0);
        $this->assertStringNotContainsString($plain, json_encode($event, JSON_THROW_ON_ERROR));
    }

    public function test_unavailable_history_keeps_general_outbox_without_duplicating_the_incident(): void
    {
        [$user, $plain] = $this->fixture();
        Schema::rename('audit_events', 'audit_events_unavailable');
        try {
            $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $plain])->assertOk();
            $this->assertDatabaseCount('security_incident_audits', 0);
            $this->assertDatabaseCount('audit_outbox', 1);
            SecurityIncidentAudit::reconcile();
            $this->assertDatabaseCount('audit_outbox', 1);
        } finally {
            Schema::rename('audit_events_unavailable', 'audit_events');
        }
        $this->assertTrue(Audit::drain());
        $this->assertTrue(Audit::drain());
        $this->assertSame(1, DB::table('audit_events')->where('action', 'auth.emergency_access_revoked')->count());
        $this->assertSame(2, (int) $user->refresh()->security_version);
    }

    public function test_receipt_deletion_failure_rolls_back_audit_admission_but_keeps_protection(): void
    {
        [$user, $plain] = $this->fixture();
        $fail = true;
        $attempted = false;
        DB::listen(static function (QueryExecuted $query) use (&$fail, &$attempted): void {
            if ($fail && str_starts_with($query->sql, 'delete from "security_incident_audits"')) {
                $attempted = true;
                throw new \RuntimeException('Fixture: receipt clearance interrupted after DELETE');
            }
        });
        $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $plain])->assertOk();
        $this->assertTrue($attempted);
        $this->assertSame(2, (int) $user->refresh()->security_version);
        $this->assertDatabaseCount('security_incident_audits', 1);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertSame(0, DB::table('audit_events')->where('action', 'auth.emergency_access_revoked')->count());
        $fail = false;
        SecurityIncidentAudit::reconcile();
        SecurityIncidentAudit::reconcile();
        $this->assertDatabaseCount('security_incident_audits', 0);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'auth.emergency_access_revoked')->count());
    }

    public function test_business_receipt_failure_rolls_back_all_state_and_preserves_the_bearer_for_retry(): void
    {
        [$user, $plain, $session] = $this->fixture();
        $before = $user->refresh()->getRawOriginal();
        $fail = true;
        $attempted = false;
        DB::listen(static function (QueryExecuted $query) use (&$fail, &$attempted): void {
            if ($fail && str_starts_with($query->sql, 'insert into "security_incident_audits"')) {
                $attempted = true;
                throw new \RuntimeException('Fixture: business receipt insert interrupted');
            }
        });
        $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $plain])->assertServerError();
        $this->assertTrue($attempted);
        $this->assertSame($before, $user->refresh()->getRawOriginal());
        $this->assertDatabaseHas('sessions', ['id' => Ids::sha256Hex($session), 'revoked_at' => null]);
        $this->assertNull(EmailToken::findOrFail(Ids::sha256Hex($plain))->used_at);
        $this->assertDatabaseCount('security_incident_audits', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
        $fail = false;
        $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $plain])->assertOk();
        $this->assertSame(2, (int) $user->refresh()->security_version);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'auth.emergency_access_revoked')->count());
    }

    public function test_pending_evidence_survives_account_removal_without_attributing_another_actor(): void
    {
        [$user, $plain] = $this->fixture();
        $id = $user->id;
        Schema::rename('audit_outbox', 'audit_outbox_unavailable');
        try {
            $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $plain])->assertOk();
            $this->assertDatabaseCount('security_incident_audits', 1);
            DB::table('users')->where('id', $id)->delete();
            $this->assertDatabaseHas('security_incident_audits', ['user_id' => null, 'affected_user_id' => $id]);
        } finally {
            Schema::rename('audit_outbox_unavailable', 'audit_outbox');
        }
        SecurityIncidentAudit::reconcile();
        SecurityIncidentAudit::reconcile();
        $this->assertDatabaseCount('security_incident_audits', 0);
        $event = DB::table('audit_events')->where('action', 'auth.emergency_access_revoked')->first();
        $this->assertNotNull($event);
        $this->assertNull($event->user_id);
        $this->assertSame((string) $id, $event->resource_id);
    }

    public function test_outer_rollback_discards_the_mutation_receipt_and_deferred_audit(): void
    {
        [$user, $plain] = $this->fixture();
        $before = $user->refresh()->getRawOriginal();
        DB::beginTransaction();
        try {
            $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $plain])->assertOk();
            $this->assertDatabaseCount('audit_outbox', 1);
            $this->assertDatabaseCount('audit_events', 0);
        } finally {
            DB::rollBack();
        }
        $this->assertSame($before, $user->refresh()->getRawOriginal());
        $this->assertNull(EmailToken::findOrFail(Ids::sha256Hex($plain))->used_at);
        $this->assertDatabaseCount('security_incident_audits', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('audit_events', 0);
    }

    public function test_recovery_failure_retains_evidence_and_does_not_advance_scheduler_health(): void
    {
        [, $plain] = $this->fixture();
        Cache::put('uvh:health:scheduler', 123);
        Schema::rename('audit_outbox', 'audit_outbox_unavailable');
        try {
            $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $plain])->assertOk();
            $output = new BufferedOutput;
            $exit = Artisan::call('uvh:housekeeping', [], $output);
            $commandOutput = $output->fetch();
            $this->assertSame(1, $exit);
            $this->assertSame(123, Cache::get('uvh:health:scheduler'));
            $this->assertDatabaseCount('security_incident_audits', 1);
            $this->assertStringNotContainsString($plain, $commandOutput);
            $this->assertStringContainsString('protective_incident_audits failed', $commandOutput);
        } finally {
            Schema::rename('audit_outbox_unavailable', 'audit_outbox');
        }
        config(['uvh.metrics.bearer_token' => 'incident-metric-fixture']);
        $response = app(OperationsController::class)->metrics(Request::create('/', 'GET', server: ['HTTP_AUTHORIZATION' => 'Bearer incident-metric-fixture']));
        $this->assertSame(200, $response->getStatusCode());
        $this->assertStringContainsString("uvh_security_incident_audits_pending 1\n", $response->getContent());
        $this->assertSame(0, Artisan::call('uvh:housekeeping'));
        $this->assertDatabaseCount('security_incident_audits', 0);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'auth.emergency_access_revoked')->count());
    }

    public function test_reconciliation_is_bounded_and_finishes_remaining_receipts_on_the_next_pass(): void
    {
        $user = User::factory()->create();
        $receipts = array_fill(0, 101, [
            'user_id' => $user->id, 'affected_user_id' => $user->id, 'administratively_blocked' => false,
            'incident_at' => now(), 'incident_correlation_id' => null,
        ]);
        DB::table('security_incident_audits')->insert($receipts);
        SecurityIncidentAudit::reconcile();
        $this->assertDatabaseCount('security_incident_audits', 1);
        $this->assertSame(100, DB::table('audit_events')->where('action', 'auth.emergency_access_revoked')->count());
        SecurityIncidentAudit::reconcile();
        SecurityIncidentAudit::reconcile();
        $this->assertDatabaseCount('security_incident_audits', 0);
        $this->assertSame(101, DB::table('audit_events')->where('action', 'auth.emergency_access_revoked')->count());
    }

    public function test_broken_fallback_logging_cannot_undo_the_protective_action(): void
    {
        [$user, $plain] = $this->fixture();
        $fail = true;
        $warningAttempted = false;
        DB::listen(static function (QueryExecuted $query) use (&$fail): void {
            if ($fail && str_starts_with($query->sql, 'insert into "audit_outbox"')) {
                throw new \RuntimeException('Fixture: general audit admission unavailable');
            }
        });
        Log::listen(static function (MessageLogged $event) use (&$warningAttempted): void {
            if ($event->message === 'Protective incident audit remains pending') {
                $warningAttempted = true;
                throw new \RuntimeException('Fixture: fallback logging unavailable');
            }
        });
        $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $plain])->assertOk();
        $this->assertTrue($warningAttempted);
        $this->assertSame(2, (int) $user->refresh()->security_version);
        $this->assertDatabaseCount('security_incident_audits', 1);
        $fail = false;
        SecurityIncidentAudit::reconcile();
        $this->assertDatabaseCount('security_incident_audits', 0);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'auth.emergency_access_revoked')->count());
    }

    public function test_record_requires_the_business_transaction_before_writing_evidence(): void
    {
        $user = User::factory()->create();
        $this->assertDatabaseCount('security_incident_audits', 0);
        $this->expectException(\LogicException::class);
        SecurityIncidentAudit::record($user, false);
    }

    public function test_two_real_reconcilers_overlap_and_admit_one_event(): void
    {
        $user = User::factory()->create();
        DB::table('security_incident_audits')->insert([
            'user_id' => $user->id, 'affected_user_id' => $user->id, 'administratively_blocked' => false, 'incident_at' => now(),
        ]);
        DB::unprepared(<<<'SQL'
            CREATE FUNCTION incident_audit_slow_delete() RETURNS trigger AS $$
            BEGIN
                PERFORM pg_sleep(0.5);
                RETURN OLD;
            END;
            $$ LANGUAGE plpgsql;
            CREATE TRIGGER incident_audit_slow_delete AFTER DELETE ON security_incident_audits
            FOR EACH ROW EXECUTE FUNCTION incident_audit_slow_delete();
            SQL);
        $environment = ['APP_ENV' => 'testing', 'DB_DATABASE' => DB::connection()->getDatabaseName()];
        $workers = [
            new Process([PHP_BINARY, base_path('tests/Support/incident-audit-reconcile.php')], base_path(), $environment),
            new Process([PHP_BINARY, base_path('tests/Support/incident-audit-reconcile.php')], base_path(), $environment),
        ];
        $overlap = false;
        try {
            foreach ($workers as $worker) {
                $worker->setTimeout(15);
                $worker->start();
            }
            $deadline = microtime(true) + 10;
            while (microtime(true) < $deadline && ($workers[0]->isRunning() || $workers[1]->isRunning())) {
                $overlap = DB::table('pg_stat_activity')->where('application_name', 'uvh-incident-audit-worker')
                    ->where('wait_event_type', 'Lock')->exists() || $overlap;
                usleep(10_000);
            }
            foreach ($workers as $worker) {
                $this->assertSame(0, $worker->wait(), $worker->getErrorOutput());
                $this->assertSame(['ok' => true], json_decode($worker->getOutput(), true, flags: JSON_THROW_ON_ERROR));
            }
            $this->assertTrue($overlap, 'A real second connection must wait on the first reconciler lock.');
            $this->assertDatabaseCount('security_incident_audits', 0);
            $this->assertSame(1, DB::table('audit_events')->where('action', 'auth.emergency_access_revoked')->count());
        } finally {
            foreach ($workers as $worker) {
                if ($worker->isRunning()) {
                    $worker->stop();
                }
            }
            DB::unprepared('DROP TRIGGER incident_audit_slow_delete ON security_incident_audits; DROP FUNCTION incident_audit_slow_delete();');
        }
    }

    /** @return array{User, string, string} */
    private function fixture(): array
    {
        $user = User::factory()->create();
        $plain = Ids::randomToken(32);
        EmailToken::create(['id' => Ids::sha256Hex($plain), 'user_id' => $user->id, 'kind' => 'security_revoke', 'expires_at' => now()->addHour()]);
        $session = SessionManager::create($user->id, Request::create('/'), 1);

        return [$user, $plain, $session];
    }
}
