<?php

namespace Tests\Feature;

use App\Models\AccountDeletionRequest;
use App\Models\DataExportRequest;
use App\Models\User;
use App\Support\Ids;
use App\Support\IsoDate;
use App\Support\SessionManager;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Native command, guarded PostgreSQL and HTTP-issued A/B handoffs. */
final class AccountDeletionLifecycleAuditTest extends TestCase
{
    private ?string $failAction = null;

    private bool $failReceiptClear = false;

    private bool $failReceiptAdmission = false;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox, mail_outbox, notifications, operational_metrics RESTART IDENTITY CASCADE');
        Queue::fake();
        Storage::fake('local');
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'lifecycle-audit')->withHeader('X-CSRF-Token', 'lifecycle-audit');
        $this->freezeSecond();
        DB::listen(function (QueryExecuted $query): void {
            if ($this->failReceiptAdmission && str_starts_with($query->sql, 'insert into "account_deletion_lifecycle_audits"')) {
                throw new \RuntimeException('Fixture lifecycle receipt admission unavailable');
            }
            if ($this->failReceiptClear && str_starts_with($query->sql, 'delete from "account_deletion_lifecycle_audits"')) {
                throw new \RuntimeException('Fixture receipt consumption unavailable');
            }
            if ($this->failAction === null || ! str_starts_with($query->sql, 'insert into "audit_outbox"')) {
                return;
            }
            foreach ($query->bindings as $binding) {
                $event = is_string($binding) ? json_decode($binding, true) : null;
                if (is_array($event) && ($event['action'] ?? '') === $this->failAction) {
                    throw new \RuntimeException('Fixture lifecycle audit admission unavailable');
                }
            }
        });
    }

    protected function tearDown(): void
    {
        while (DB::transactionLevel() > 0) {
            DB::rollBack();
        }
        $this->travelBack();
        parent::tearDown();
    }

    private function claimed(User $user, string $name): array
    {
        $raw = SessionManager::create($user->id, Request::create('/'), 1, true);
        $this->withCookie('uvh_session', $raw);
        $token = $this->postJson('/api/v1/link-intents', ['destination' => 'https://example.com/'.$name])->assertCreated()->json('intent');
        $this->assertIsString($token);
        $this->postJson('/api/v1/link-intents/claim', ['intent' => $token])->assertOk();
        $hash = Ids::sha256Hex($token);
        $record = Cache::get('link-intent:'.$hash);
        $this->assertIsArray($record);

        return ['hash' => $hash, 'record' => $record, 'session' => Ids::sha256Hex($raw)];
    }

    private function fixture(string $mode): array
    {
        $user = User::factory()->create();
        $other = User::factory()->create();
        $mine = $this->claimed($user, 'private-owner');
        $theirs = $this->claimed($other, 'private-other');
        $path = 'account-exports/'.str_repeat('a', 32).'.uvh';
        Storage::disk('local')->put($path, 'isolated-private-export');
        $export = DataExportRequest::create([
            'user_id' => $user->id, 'security_version' => 1, 'status' => 'ready',
            'artifact_path' => $path, 'ready_at' => now(), 'download_expires_at' => now()->addDay(),
        ])->refresh();
        $user->update(['deleted_at' => $mode === 'active' ? null : now()]);
        $cancel = Ids::randomToken(32);
        $row = AccountDeletionRequest::create([
            'user_id' => $user->id, 'security_version' => 1, 'status' => 'scheduled',
            'cancel_token_hash' => Ids::sha256Hex($cancel), 'execute_after' => now(),
        ])->refresh();
        // Manual exact-generation SENT receipt and due-now fixture: this tests
        // admission effects, not SMTP delivery or the real seven-day wait.
        if ($mode !== 'mail') {
            DB::table('mail_outbox')->insert([
                'idempotency_key' => Ids::sha256Hex('lifecycle-fixture-'.$row->id), 'encrypted_envelope' => 'not-delivered-fixture',
                'kind' => 'account_deletion_scheduled', 'resource_type' => 'account_deletion',
                'resource_id' => (string) $row->id, 'resource_generation' => $row->cancel_token_hash,
                'status' => 'sent', 'sent_at' => now(), 'available_at' => now(), 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
        if ($mode === 'owned') {
            $workspace = DB::table('workspaces')->insertGetId([
                'name' => 'Still owned', 'slug' => 'owned-lifecycle', 'owner_user_id' => $user->id,
                'created_at' => now(), 'updated_at' => now(),
            ]);
            DB::table('memberships')->insert(['workspace_id' => $workspace, 'user_id' => $user->id, 'role' => 'owner', 'created_at' => now()]);
        }

        return compact('user', 'other', 'mine', 'theirs', 'row', 'export', 'path');
    }

    private function runNative(): int
    {
        Cache::forget('uvh:housekeeping:last_heavy');

        return Artisan::call('uvh:housekeeping');
    }

    private function retained(array $intent): void
    {
        $this->assertSame($intent['record'], Cache::get('link-intent:'.$intent['hash']));
        $this->assertDatabaseHas('link_intent_claims', ['intent_hash' => $intent['hash']]);
    }

    private function foreignUnchanged(array $fixture, int $counter): void
    {
        $this->retained($fixture['theirs']);
        $this->assertSame(1, $fixture['other']->refresh()->security_version);
        $this->assertNull(DB::table('sessions')->where('id', $fixture['theirs']['session'])->value('revoked_at'));
        $this->assertSame($counter, Cache::get($fixture['theirs']['record']['counter_key']));
        $this->assertSame($counter, Cache::get($fixture['theirs']['record']['global_counter_key']));
    }

    public static function failures(): array
    {
        return [['php'], ['sql']];
    }

    #[DataProvider('failures')]
    public function test_failed_execution_audit_admission_does_not_anonymize_or_destroy_exports(string $failure): void
    {
        $f = $this->fixture('execute');
        $userBefore = $f['user']->refresh()->getRawOriginal();
        $caseBefore = $f['row']->getRawOriginal();
        $exportBefore = $f['export']->getRawOriginal();
        $this->failAction = $failure === 'php' ? 'account.deletion_executed' : null;
        if ($failure === 'sql') {
            Schema::rename('audit_outbox', 'audit_outbox_unavailable');
        }
        try {
            $code = $this->runNative();
            $this->assertSame($userBefore, $f['user']->refresh()->getRawOriginal());
            $this->assertSame($caseBefore, $f['row']->refresh()->getRawOriginal());
            $this->assertSame($exportBefore, $f['export']->refresh()->getRawOriginal());
            $this->retained($f['mine']);
            $this->foreignUnchanged($f, 2);
            Storage::disk('local')->assertExists($f['path']);
            $this->assertSame(1, $code);
            $this->assertNull(Cache::get('uvh:housekeeping:last_heavy'));
            $this->assertNull(Cache::get('uvh:health:scheduler'));
        } finally {
            $this->failAction = null;
            if ($failure === 'sql') {
                Schema::rename('audit_outbox_unavailable', 'audit_outbox');
            }
        }
        $this->assertSame(0, $this->runNative(), Artisan::output());
        $this->assertSame('executed', $f['row']->refresh()->status);
        $this->assertSame('Cuenta eliminada', $f['user']->refresh()->name);
        Storage::disk('local')->assertMissing($f['path']);
        $this->assertNull(Cache::get('link-intent:'.$f['mine']['hash']));
        $this->foreignUnchanged($f, 1);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.deletion_executed')->count());
    }

    public static function protectiveFailures(): array
    {
        return [['mail', 'php'], ['mail', 'sql'], ['owned', 'php'], ['owned', 'sql']];
    }

    #[DataProvider('protectiveFailures')]
    public function test_protective_outcome_retains_exact_audit_for_later_native_recovery(string $mode, string $failure): void
    {
        $f = $this->fixture($mode);
        $name = $f['user']->name;
        $action = $mode === 'mail' ? 'account.deletion_cancelled_mail_unconfirmed' : 'account.deletion_blocked';
        $this->failAction = $failure === 'php' ? $action : null;
        if ($failure === 'sql') {
            Schema::rename('audit_outbox', 'audit_outbox_unavailable');
        }
        try {
            $code = $this->runNative();
            $this->assertNull($f['user']->refresh()->deleted_at);
            $this->assertSame($name, $f['user']->name);
            $this->assertSame(2, $f['user']->security_version);
            $this->assertSame('cancelled', $f['row']->refresh()->status);
            $this->assertNull($f['row']->cancel_token_hash);
            $this->assertSame('ready', $f['export']->refresh()->status);
            Storage::disk('local')->assertExists($f['path']);
            $this->assertNull(Cache::get('link-intent:'.$f['mine']['hash']));
            $this->foreignUnchanged($f, 1);
            $this->assertSame(0, DB::table('audit_events')->where('action', $action)->count());
            $receipt = DB::table('account_deletion_lifecycle_audits')->sole();
            $this->assertSame($action, $receipt->action);
            $this->assertSame($f['user']->id, $receipt->user_id);
            $this->assertSame($f['row']->id, $receipt->affected_request_id);
            $this->assertSame(IsoDate::format(now()), IsoDate::format($receipt->lifecycle_at));
            $this->assertNull(Cache::get('uvh:health:scheduler'));
        } finally {
            $this->failAction = null;
            if ($failure === 'sql') {
                Schema::rename('audit_outbox_unavailable', 'audit_outbox');
            }
        }
        $this->assertSame(0, $this->runNative(), Artisan::output());
        $this->assertSame(0, $this->runNative(), Artisan::output());
        $this->assertSame(1, DB::table('audit_events')->where('action', $action)->count());
        $this->assertSame(1, $code, 'A pass with pending required evidence must report failure');
        $this->assertSame(0, DB::table('audit_events')->where('action', 'account.deletion_cancelled')->count());
        $this->assertSame(2, $f['user']->refresh()->security_version);
        $this->assertDatabaseCount('account_deletion_lifecycle_audits', 0);
        $this->foreignUnchanged($f, 1);
    }

    public static function transactionOutcomes(): array
    {
        $cases = [];
        foreach (['execute', 'mail', 'owned', 'active'] as $mode) {
            foreach (['normal', 'commit', 'rollback', 'savepoint'] as $outcome) {
                $cases[$mode.' '.$outcome] = [$mode, $outcome];
            }
        }

        return $cases;
    }

    #[DataProvider('transactionOutcomes')]
    public function test_native_lifecycle_business_evidence_and_cleanup_follow_outer_commit(string $mode, string $outcome): void
    {
        $f = $this->fixture($mode);
        $before = [
            $f['user']->refresh()->getRawOriginal(), $f['row']->getRawOriginal(), $f['export']->getRawOriginal(),
            DB::table('sessions')->where('user_id', $f['user']->id)->get()->toJson(),
            DB::table('mail_outbox')->get()->toJson(),
        ];
        $action = match ($mode) {
            'execute' => 'account.deletion_executed',
            'mail' => 'account.deletion_cancelled_mail_unconfirmed',
            default => 'account.deletion_blocked',
        };
        if ($outcome !== 'normal') {
            DB::beginTransaction();
        }
        if ($outcome === 'savepoint') {
            DB::beginTransaction();
        }
        $this->assertSame(0, $this->runNative(), Artisan::output());
        $this->assertSame($mode === 'execute' ? 'executed' : ($mode === 'active' ? 'blocked' : 'cancelled'), $f['row']->refresh()->status);
        $this->assertDatabaseCount('account_deletion_lifecycle_audits', 0);
        if ($outcome !== 'normal') {
            $this->retained($f['mine']);
            Storage::disk('local')->assertExists($f['path']);
            $this->foreignUnchanged($f, 2);
            $pending = DB::table('audit_outbox')->get()->filter(static fn ($r) => json_decode($r->event, true)['action'] === $action);
            $this->assertCount(1, $pending);
            $this->assertSame(0, DB::table('audit_events')->where('action', $action)->count());
            if ($outcome === 'commit') {
                DB::commit();
            } else {
                DB::rollBack();
                if ($outcome === 'savepoint') {
                    DB::commit();
                }
            }
        }
        if (in_array($outcome, ['rollback', 'savepoint'], true)) {
            $this->assertSame($before, [
                $f['user']->refresh()->getRawOriginal(), $f['row']->refresh()->getRawOriginal(), $f['export']->refresh()->getRawOriginal(),
                DB::table('sessions')->where('user_id', $f['user']->id)->get()->toJson(), DB::table('mail_outbox')->get()->toJson(),
            ]);
            $this->retained($f['mine']);
            Storage::disk('local')->assertExists($f['path']);
            $this->foreignUnchanged($f, 2);
            $this->assertSame(0, DB::table('audit_events')->where('action', $action)->count());
            $this->assertDatabaseCount('audit_outbox', 0);

            return;
        }
        $this->assertSame(1, DB::table('audit_events')->where('action', $action)->count());
        $this->assertSame($mode === 'active' ? 1 : 2, $f['user']->refresh()->security_version);
        if ($mode === 'execute') {
            $this->assertSame('Cuenta eliminada', $f['user']->name);
            $this->assertNull($f['user']->email_verified_at);
            $this->assertFalse($f['user']->mfa_enabled);
            $this->assertStringEndsWith('@deleted.invalid', $f['user']->email);
            $this->assertSame('cancelled', $f['export']->refresh()->status);
            $this->assertSame(0, DB::table('sessions')->where('user_id', $f['user']->id)->count());
            Storage::disk('local')->assertMissing($f['path']);
        } else {
            $this->assertSame($before[0]['name'], $f['user']->name);
            $this->assertSame($before[0]['email'], $f['user']->email);
            $this->assertNull($f['user']->deleted_at);
            $this->assertSame('ready', $f['export']->refresh()->status);
            $this->assertNull(DB::table('sessions')->where('id', $f['mine']['session'])->value('revoked_at'));
            Storage::disk('local')->assertExists($f['path']);
        }
        if ($mode === 'active') {
            $this->retained($f['mine']);
        } else {
            $this->assertNull(Cache::get('link-intent:'.$f['mine']['hash']));
        }
        $this->foreignUnchanged($f, $mode === 'active' ? 2 : 1);
    }

    public static function lifecycleModes(): array
    {
        return [['execute'], ['mail'], ['owned'], ['active']];
    }

    public static function protectiveModes(): array
    {
        return [['mail'], ['owned'], ['active']];
    }

    #[DataProvider('protectiveModes')]
    public function test_protection_cannot_commit_without_its_required_recovery_receipt(string $mode): void
    {
        $f = $this->fixture($mode);
        $before = [$f['user']->refresh()->getRawOriginal(), $f['row']->getRawOriginal()];
        $this->failReceiptAdmission = true;
        $this->assertSame(1, $this->runNative());
        $this->assertSame($before, [$f['user']->refresh()->getRawOriginal(), $f['row']->refresh()->getRawOriginal()]);
        $this->assertDatabaseCount('account_deletion_lifecycle_audits', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->retained($f['mine']);
        Storage::disk('local')->assertExists($f['path']);
        $this->foreignUnchanged($f, 2);
        $this->assertNull(Cache::get('uvh:health:scheduler'));
        $this->failReceiptAdmission = false;
        $this->assertSame(0, $this->runNative(), Artisan::output());
    }

    public static function pendingTransactionOutcomes(): array
    {
        $cases = [];
        foreach (['mail', 'owned', 'active'] as $mode) {
            foreach (['commit', 'rollback', 'savepoint'] as $outcome) {
                $cases[$mode.' '.$outcome] = [$mode, $outcome];
            }
        }

        return $cases;
    }

    #[DataProvider('pendingTransactionOutcomes')]
    public function test_pending_recovery_receipt_and_protection_share_the_outer_transaction(string $mode, string $outcome): void
    {
        $f = $this->fixture($mode);
        $before = [$f['user']->refresh()->getRawOriginal(), $f['row']->getRawOriginal()];
        $action = $mode === 'mail' ? 'account.deletion_cancelled_mail_unconfirmed' : 'account.deletion_blocked';
        $this->failAction = $action;
        DB::beginTransaction();
        if ($outcome === 'savepoint') {
            DB::beginTransaction();
        }
        $this->assertSame(1, $this->runNative());
        $this->assertDatabaseCount('account_deletion_lifecycle_audits', 1);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->retained($f['mine']);
        $this->foreignUnchanged($f, 2);
        if ($outcome === 'commit') {
            DB::commit();
        } else {
            DB::rollBack();
            if ($outcome === 'savepoint') {
                DB::commit();
            }
        }
        $this->failAction = null;
        if ($outcome !== 'commit') {
            $this->assertSame($before, [$f['user']->refresh()->getRawOriginal(), $f['row']->refresh()->getRawOriginal()]);
            $this->assertDatabaseCount('account_deletion_lifecycle_audits', 0);
            $this->retained($f['mine']);
            $this->foreignUnchanged($f, 2);
            $this->assertSame(0, DB::table('audit_events')->where('action', $action)->count());
        } else {
            $this->assertNull($f['user']->refresh()->deleted_at);
            $this->assertSame($mode === 'active' ? 'blocked' : 'cancelled', $f['row']->refresh()->status);
            $this->assertSame($mode === 'active' ? 1 : 2, $f['user']->security_version);
            $this->assertDatabaseCount('account_deletion_lifecycle_audits', 1);
            if ($mode === 'active') {
                $this->retained($f['mine']);
            } else {
                $this->assertNull(Cache::get('link-intent:'.$f['mine']['hash']));
            }
            $this->foreignUnchanged($f, $mode === 'active' ? 2 : 1);
            Cache::put('uvh:housekeeping:last_heavy', (int) floor(microtime(true) * 1000), 3600);
            $this->assertSame(0, Artisan::call('uvh:housekeeping'), Artisan::output());
            $this->assertSame(1, DB::table('audit_events')->where('action', $action)->count());
            $this->assertDatabaseCount('account_deletion_lifecycle_audits', 0);
        }
        Storage::disk('local')->assertExists($f['path']);
        $this->assertSame('ready', $f['export']->refresh()->status);
    }

    #[DataProvider('lifecycleModes')]
    public function test_history_outage_keeps_exactly_one_durable_event_and_later_native_pass_materializes_it(string $mode): void
    {
        $f = $this->fixture($mode);
        $action = match ($mode) {
            'execute' => 'account.deletion_executed',
            'mail' => 'account.deletion_cancelled_mail_unconfirmed',
            default => 'account.deletion_blocked',
        };
        Schema::rename('audit_events', 'lifecycle_history_unavailable');
        try {
            $this->assertSame(1, $this->runNative());
            $this->assertNull(Cache::get('uvh:health:scheduler'));
            $event = json_decode(DB::table('audit_outbox')->sole()->event, true);
            $this->assertSame($action, $event['action']);
            $this->assertSame((string) $f['row']->id, $event['resource_id']);
            $this->assertSame($f['user']->id, $event['user_id']);
            $this->assertDatabaseCount('account_deletion_lifecycle_audits', 0);
            $this->assertSame($mode === 'execute' ? 'executed' : ($mode === 'active' ? 'blocked' : 'cancelled'), $f['row']->refresh()->status);
            if ($mode === 'execute') {
                Storage::disk('local')->assertMissing($f['path']);
            } else {
                Storage::disk('local')->assertExists($f['path']);
            }
        } finally {
            Schema::rename('lifecycle_history_unavailable', 'audit_events');
        }
        $this->assertSame(0, $this->runNative(), Artisan::output());
        $this->assertSame(0, $this->runNative(), Artisan::output());
        $this->assertSame(1, DB::table('audit_events')->where('action', $action)->count());
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->foreignUnchanged($f, $mode === 'active' ? 2 : 1);
    }

    public function test_receipt_consumption_failure_rolls_back_only_admission_and_recovers_once(): void
    {
        $f = $this->fixture('mail');
        $this->failReceiptClear = true;
        $this->assertSame(1, $this->runNative());
        $this->assertNull($f['user']->refresh()->deleted_at);
        $this->assertSame('cancelled', $f['row']->refresh()->status);
        $this->assertDatabaseCount('account_deletion_lifecycle_audits', 1);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertSame(0, DB::table('audit_events')->where('action', 'account.deletion_cancelled_mail_unconfirmed')->count());
        $this->assertSame(1, $this->runNative());
        $this->assertDatabaseCount('account_deletion_lifecycle_audits', 1);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->failReceiptClear = false;
        $this->assertSame(0, $this->runNative(), Artisan::output());
        $this->assertSame(0, $this->runNative(), Artisan::output());
        $this->assertDatabaseCount('account_deletion_lifecycle_audits', 0);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.deletion_cancelled_mail_unconfirmed')->count());
        $this->assertSame(2, $f['user']->refresh()->security_version);
        Storage::disk('local')->assertExists($f['path']);
        $this->foreignUnchanged($f, 1);
    }

    public function test_broken_logs_and_metrics_do_not_erase_protection_or_pending_evidence(): void
    {
        $f = $this->fixture('mail');
        $this->failAction = 'account.deletion_cancelled_mail_unconfirmed';
        Log::shouldReceive('critical')->andThrow(new \RuntimeException('Fixture log unavailable'));
        Log::shouldReceive('warning')->andThrow(new \RuntimeException('Fixture log unavailable'));
        Schema::rename('operational_metrics', 'lifecycle_metrics_unavailable');
        try {
            $this->assertSame(1, $this->runNative());
            $this->assertNull($f['user']->refresh()->deleted_at);
            $this->assertSame(2, $f['user']->security_version);
            $this->assertSame('cancelled', $f['row']->refresh()->status);
            $this->assertDatabaseCount('account_deletion_lifecycle_audits', 1);
            $this->assertDatabaseCount('audit_outbox', 0);
            $this->assertNull(Cache::get('uvh:health:scheduler'));
        } finally {
            Schema::rename('lifecycle_metrics_unavailable', 'operational_metrics');
            $this->failAction = null;
        }
        $this->assertSame(0, $this->runNative(), Artisan::output());
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.deletion_cancelled_mail_unconfirmed')->count());
        Storage::disk('local')->assertExists($f['path']);
        $this->foreignUnchanged($f, 1);
    }

    public static function laterIdentityChanges(): array
    {
        return [['generation'], ['request'], ['actor']];
    }

    #[DataProvider('laterIdentityChanges')]
    public function test_recovery_preserves_original_reason_time_and_resource_after_identity_changes(string $change): void
    {
        $f = $this->fixture('mail');
        $this->failAction = 'account.deletion_cancelled_mail_unconfirmed';
        $this->assertSame(1, $this->runNative());
        $originalTime = IsoDate::format(now());
        $this->travel(2)->hours();
        if ($change === 'generation') {
            $f['row']->update(['cancel_token_hash' => Ids::sha256Hex(Ids::randomToken(32)), 'cancelled_at' => now()]);
        } elseif ($change === 'request') {
            DB::table('account_deletion_requests')->where('id', $f['row']->id)->delete();
        } else {
            DB::table('users')->where('id', $f['user']->id)->delete();
        }
        $receipt = DB::table('account_deletion_lifecycle_audits')->sole();
        $this->assertSame($f['row']->id, $receipt->affected_request_id);
        $this->assertSame($originalTime, IsoDate::format($receipt->lifecycle_at));
        $this->assertSame($change === 'actor' ? null : $f['user']->id, $receipt->user_id);
        $this->assertSame($change === 'generation' ? $f['row']->id : null, $receipt->request_id);
        $this->failAction = null;
        // Reconciliation is independent of the heavy retention checkpoint.
        Cache::put('uvh:housekeeping:last_heavy', (int) floor(microtime(true) * 1000), 3600);
        $this->assertSame(0, Artisan::call('uvh:housekeeping'), Artisan::output());
        $event = DB::table('audit_events')->where('action', 'account.deletion_cancelled_mail_unconfirmed')->sole();
        $this->assertSame((string) $f['row']->id, $event->resource_id);
        $this->assertSame($change === 'actor' ? null : $f['user']->id, $event->user_id);
        $metadata = json_decode($event->metadata, true);
        $this->assertSame($originalTime, $metadata['lifecycle_at']);
        $this->assertSame(['lifecycle_at'], array_keys($metadata));
        $this->assertDatabaseCount('account_deletion_lifecycle_audits', 0);
        $this->assertSame(0, Artisan::call('uvh:housekeeping'));
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.deletion_cancelled_mail_unconfirmed')->count());
    }

    public function test_active_account_is_not_anonymized_and_block_transition_is_audited(): void
    {
        $f = $this->fixture('active');
        $before = $f['user']->refresh()->getRawOriginal();
        $this->assertSame(0, $this->runNative(), Artisan::output());
        $this->assertSame($before, $f['user']->refresh()->getRawOriginal());
        $this->assertSame('blocked', $f['row']->refresh()->status);
        $this->retained($f['mine']);
        $this->foreignUnchanged($f, 2);
        Storage::disk('local')->assertExists($f['path']);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.deletion_blocked')->count());
    }

    public function test_native_bounded_recovery_does_not_publish_a_healthy_heartbeat_while_receipts_remain(): void
    {
        $f = $this->fixture('active');
        $f['row']->update(['status' => 'cancelled', 'cancel_token_hash' => null, 'cancelled_at' => now()]);
        DB::table('account_deletion_lifecycle_audits')->insert(array_fill(0, 101, [
            'user_id' => $f['user']->id, 'request_id' => $f['row']->id, 'affected_request_id' => $f['row']->id,
            'action' => 'account.deletion_blocked', 'lifecycle_at' => now(),
        ]));
        Cache::put('uvh:housekeeping:last_heavy', (int) floor(microtime(true) * 1000), 3600);
        $this->assertSame(1, Artisan::call('uvh:housekeeping'), Artisan::output());
        $this->assertNull(Cache::get('uvh:health:scheduler'));
        $this->assertDatabaseCount('account_deletion_lifecycle_audits', 1);
        $this->assertSame(100, DB::table('audit_events')->where('action', 'account.deletion_blocked')->count());
        $this->retained($f['mine']);
        $this->foreignUnchanged($f, 2);
        $this->assertSame(0, Artisan::call('uvh:housekeeping'), Artisan::output());
        $this->assertNotNull(Cache::get('uvh:health:scheduler'));
        $this->assertDatabaseCount('account_deletion_lifecycle_audits', 0);
        $this->assertSame(101, DB::table('audit_events')->where('action', 'account.deletion_blocked')->count());
        $this->assertSame(0, Artisan::call('uvh:housekeeping'));
        $this->assertSame(101, DB::table('audit_events')->where('action', 'account.deletion_blocked')->count());
        Storage::disk('local')->assertExists($f['path']);
    }
}
