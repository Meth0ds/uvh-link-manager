<?php

namespace Tests\Feature;

use App\Models\AccountDeletionRequest;
use App\Models\AccountRecoveryRequest;
use App\Models\DataExportRequest;
use App\Models\EmailToken;
use App\Models\User;
use App\Support\Ids;
use App\Support\LinkIntentRegistry;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Real HTTP handoffs and guarded SQL, with independent cache and fake files. */
final class SecurityIntentCommitEffectsTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox, mail_outbox, notifications, operational_metrics RESTART IDENTITY CASCADE');
        Queue::fake();
        Storage::fake('local');
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'security-commit')->withHeader('X-CSRF-Token', 'security-commit');
        $this->freezeSecond();
    }

    protected function tearDown(): void
    {
        while (DB::transactionLevel() > 0) {
            DB::rollBack();
        }
        $this->travelBack();
        parent::tearDown();
    }

    private function claimed(User $user, string $path): array
    {
        $raw = SessionManager::create($user->id, Request::create('/'), 1, true);
        $this->withCookie('uvh_session', $raw);
        $token = $this->postJson('/api/v1/link-intents', ['destination' => 'https://example.com/'.$path])->assertCreated()->json('intent');
        $this->assertIsString($token);
        $this->postJson('/api/v1/link-intents/claim', ['intent' => $token])->assertOk();
        $hash = Ids::sha256Hex($token);
        $record = Cache::get('link-intent:'.$hash);
        $this->assertIsArray($record);
        $this->assertSame($user->id, $record['claimed_by']);

        return ['hash' => $hash, 'token' => $token, 'record' => $record, 'session' => Ids::sha256Hex($raw)];
    }

    private function artifact(User $user): DataExportRequest
    {
        $path = 'account-exports/'.str_repeat('a', 32).'.uvh';
        Storage::disk('local')->put($path, 'isolated-private-fixture');

        return DataExportRequest::create([
            'user_id' => $user->id, 'security_version' => 1, 'status' => 'ready',
            'artifact_path' => $path, 'ready_at' => now(), 'download_expires_at' => now()->addDay(),
        ]);
    }

    private function prepare(string $action, User $owner): array
    {
        $token = Ids::randomToken(32);
        if ($action === 'incident') {
            EmailToken::create(['id' => Ids::sha256Hex($token), 'user_id' => $owner->id, 'kind' => 'security_revoke', 'expires_at' => now()->addHour()]);
        } elseif ($action === 'admin') {
            $admin = User::factory()->create(['is_admin' => true, 'mfa_enabled' => true]);
            $this->withCookie('uvh_session', SessionManager::create($admin->id, Request::create('/'), 1, true));
        } elseif ($action === 'recovery') {
            $row = AccountRecoveryRequest::create([
                'user_id' => $owner->id, 'security_version' => 1, 'status' => 'approved',
                'completion_token_hash' => Ids::sha256Hex($token), 'completion_expires_at' => now()->addMinutes(30),
                'expires_at' => now()->addDays(7),
            ]);
            foreach ([1, 2] as $index) {
                $admin = User::factory()->create(['is_admin' => true, 'mfa_enabled' => true]);
                DB::table('account_recovery_approvals')->insert([
                    'request_id' => $row->id, 'admin_user_id' => $admin->id,
                    'reason_code' => 'identity_verified_external', 'created_at' => now(),
                ]);
            }
        } else {
            // A due, exact-generation SENT receipt exercises deletion admission;
            // no time travel, grace-period or SMTP-delivery claim is made here.
            $owner->update(['deleted_at' => now()]);
            $row = AccountDeletionRequest::create([
                'user_id' => $owner->id, 'security_version' => 1, 'status' => 'scheduled',
                'cancel_token_hash' => Ids::sha256Hex($token), 'execute_after' => now(),
            ]);
            DB::table('mail_outbox')->insert([
                'idempotency_key' => Ids::sha256Hex('fixture-'.$row->id), 'encrypted_envelope' => 'not-delivered-fixture',
                'kind' => 'account_deletion_scheduled', 'resource_type' => 'account_deletion',
                'resource_id' => (string) $row->id, 'resource_generation' => $row->cancel_token_hash,
                'status' => 'sent', 'sent_at' => now(), 'available_at' => now(), 'created_at' => now(), 'updated_at' => now(),
            ]);
            Cache::forget('uvh:housekeeping:last_heavy');
        }

        return ['token' => $token];
    }

    private function act(string $action, User $owner, array $context): void
    {
        if ($action === 'incident') {
            $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $context['token']])->assertOk();
        } elseif ($action === 'admin') {
            $this->patchJson('/api/v1/admin/users/'.$owner->id, ['blocked' => true])->assertOk();
        } elseif ($action === 'recovery') {
            $this->postJson('/api/v1/auth/account-recovery/complete', [
                'token' => $context['token'], 'password' => 'brujula-limonero-zafiro-93', 'confirmation' => 'RECUPERAR MI CUENTA',
            ])->assertOk();
        } else {
            $this->assertSame(0, Artisan::call('uvh:housekeeping'), Artisan::output());
        }
    }

    private function retained(User $user, array $intent): void
    {
        $this->assertSame($intent['record'], Cache::get('link-intent:'.$intent['hash']));
        $this->assertDatabaseHas('link_intent_claims', ['intent_hash' => $intent['hash'], 'user_id' => $user->id]);
    }

    private function counters(array $intent, int $expected): void
    {
        $this->assertSame($expected, Cache::get($intent['record']['counter_key']));
        $this->assertSame($expected, Cache::get($intent['record']['global_counter_key']));
    }

    /** Only transaction-owned tables; independent cache/file state is separate. */
    private function sqlSnapshot(): array
    {
        $snapshot = [];
        foreach (['users', 'sessions', 'email_tokens', 'account_recovery_requests', 'account_recovery_approvals', 'account_deletion_requests', 'data_export_requests', 'mail_outbox', 'audit_outbox', 'audit_events', 'security_incident_audits', 'link_intent_claims'] as $table) {
            $snapshot[$table] = DB::table($table)->orderBy($table === 'link_intent_claims' ? 'intent_hash' : 'id')->get()->toJson();
        }

        return $snapshot;
    }

    public static function actionsAndOutcomes(): array
    {
        $cases = [];
        foreach (['incident', 'admin', 'recovery', 'housekeeping'] as $action) {
            foreach (['normal', 'commit', 'rollback', 'savepoint'] as $outcome) {
                $cases[$action.'-'.$outcome] = [$action, $outcome];
            }
        }

        return $cases;
    }

    #[DataProvider('actionsAndOutcomes')]
    public function test_external_cleanup_follows_only_durable_security_change(string $action, string $outcome): void
    {
        $owner = User::factory()->create(['mfa_enabled' => true, 'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP')]);
        $other = User::factory()->create();
        $mine = $this->claimed($owner, 'owner-private');
        $theirs = $this->claimed($other, 'other-private');
        $export = $this->artifact($owner);
        $path = $export->artifact_path;
        $context = $this->prepare($action, $owner);
        $before = $this->sqlSnapshot();
        if ($outcome !== 'normal') {
            DB::beginTransaction();
            if ($outcome === 'savepoint') {
                DB::beginTransaction();
            }
        }
        $this->act($action, $owner, $context);
        $this->assertSame(2, $owner->refresh()->security_version);
        $this->assertSame('cancelled', $export->refresh()->status);
        if ($outcome !== 'normal') {
            $this->retained($owner, $mine);
            $this->retained($other, $theirs);
            $this->counters($mine, 2);
            Storage::disk('local')->assertExists($path);
            $this->assertSame($path, $export->artifact_path);
            if ($outcome === 'commit') {
                DB::commit();
            } else {
                DB::rollBack();
                if ($outcome === 'savepoint') {
                    DB::commit();
                }
            }
        }
        if (in_array($outcome, ['normal', 'commit'], true)) {
            $this->assertNull(Cache::get('link-intent:'.$mine['hash']));
            $this->assertDatabaseMissing('link_intent_claims', ['intent_hash' => $mine['hash']]);
            $this->counters($theirs, 1);
            Storage::disk('local')->assertMissing($path);
            $this->assertNull($export->refresh()->artifact_path);
            if ($action === 'housekeeping') {
                $this->assertSame('Cuenta eliminada', $owner->refresh()->name);
                $this->assertDatabaseHas('account_deletion_requests', ['user_id' => $owner->id, 'status' => 'executed']);
                $this->assertDatabaseMissing('sessions', ['id' => $mine['session']]);
            } else {
                $this->assertNotNull(DB::table('sessions')->where('id', $mine['session'])->value('revoked_at'));
            }
            $this->assertSame(in_array($action, ['incident', 'admin'], true), $owner->refresh()->mfa_enabled);
        } else {
            $this->assertSame($before, $this->sqlSnapshot());
            $this->retained($owner, $mine);
            $this->counters($mine, 2);
            Storage::disk('local')->assertExists($path);
            $this->assertSame('ready', $export->refresh()->status);
        }
        $this->retained($other, $theirs);
        $this->assertSame(1, $other->refresh()->security_version);
        $this->assertNull(DB::table('sessions')->where('id', $theirs['session'])->value('revoked_at'));
        // The foreign session's claimed handoff remains usable through HTTP.
        $this->withCookie('uvh_session', SessionManager::create($other->id, Request::create('/'), 1, true));
        $this->postJson('/api/v1/link-intents/claim', ['intent' => $theirs['token']])->assertOk()->assertJsonPath('destination', 'https://example.com/other-private');
    }

    public static function exportOutcomes(): array
    {
        $cases = [];
        foreach (['stalled', 'expired'] as $state) {
            foreach (['normal', 'commit', 'rollback', 'savepoint'] as $outcome) {
                $cases[$state.'-'.$outcome] = [$state, $outcome];
            }
        }

        return $cases;
    }

    #[DataProvider('exportOutcomes')]
    public function test_native_retention_does_not_delete_a_file_from_a_rolled_back_transition(string $state, string $outcome): void
    {
        $user = User::factory()->create();
        $export = $this->artifact($user);
        $path = $export->artifact_path;
        DB::table('data_export_requests')->where('id', $export->id)->update([
            'status' => $state === 'stalled' ? 'processing' : 'ready',
            'updated_at' => now()->subMinutes(31), 'download_expires_at' => now()->subSecond(),
        ]);
        $before = $export->refresh()->getRawOriginal();
        if ($outcome !== 'normal') {
            DB::beginTransaction();
            if ($outcome === 'savepoint') {
                DB::beginTransaction();
            }
        }
        $this->assertSame(0, Artisan::call('uvh:housekeeping'), Artisan::output());
        $this->assertSame($state === 'stalled' ? 'failed' : 'expired', $export->refresh()->status);
        if ($outcome !== 'normal') {
            Storage::disk('local')->assertExists($path);
            $this->assertSame($path, $export->artifact_path);
            if ($outcome === 'commit') {
                DB::commit();
            } else {
                DB::rollBack();
                if ($outcome === 'savepoint') {
                    DB::commit();
                }
            }
        }
        if (in_array($outcome, ['normal', 'commit'], true)) {
            Storage::disk('local')->assertMissing($path);
            $this->assertNull($export->refresh()->artifact_path);
            $this->assertSame(1, (int) DB::table('operational_metrics')->where('metric', 'export.cleaned')->sum('count'));
        } else {
            Storage::disk('local')->assertExists($path);
            $this->assertSame($before, $export->refresh()->getRawOriginal());
            $this->assertSame(0, (int) DB::table('operational_metrics')->where('metric', 'export.cleaned')->sum('count'));
        }
    }

    public static function actions(): array
    {
        return [['incident'], ['admin'], ['recovery'], ['housekeeping']];
    }

    #[DataProvider('actions')]
    public function test_cache_lock_outage_preserves_retry_pointer_without_undoing_security(string $action): void
    {
        $owner = User::factory()->create(['mfa_enabled' => true]);
        $mine = $this->claimed($owner, 'retry-private');
        $context = $this->prepare($action, $owner);
        $lock = Cache::lock('link-intent-lock:'.$mine['hash'], 5);
        $this->assertTrue($lock->get());
        try {
            DB::beginTransaction();
            $this->act($action, $owner, $context);
            $this->retained($owner, $mine);
            DB::commit();
            $this->assertSame(2, $owner->refresh()->security_version);
            $this->retained($owner, $mine);
            $this->counters($mine, 1);
        } finally {
            $lock->release();
        }
        $this->assertSame(['revoked' => 1, 'busy' => 0], LinkIntentRegistry::revokeForUser($owner->id));
        $this->assertNull(Cache::get('link-intent:'.$mine['hash']));
        $this->counters($mine, 0);
    }

    public function test_admin_secondary_audit_failure_waits_for_commit_and_does_not_reject_durable_block(): void
    {
        $owner = User::factory()->create();
        $mine = $this->claimed($owner, 'audit-private');
        $context = $this->prepare('admin', $owner);
        $failed = false;
        DB::listen(static function (QueryExecuted $query) use (&$failed): void {
            if (! str_starts_with($query->sql, 'insert into "audit_outbox"')) {
                return;
            }
            foreach ($query->bindings as $binding) {
                $event = is_string($binding) ? json_decode($binding, true) : null;
                if (is_array($event) && ($event['action'] ?? '') === 'admin.user_intents_revoked') {
                    $failed = true;
                    throw new \RuntimeException('Fixture secondary reconciliation audit failed');
                }
            }
        });
        DB::beginTransaction();
        $this->act('admin', $owner, $context);
        $this->assertFalse($failed);
        DB::commit();
        $this->assertTrue($failed);
        $this->assertNotNull($owner->refresh()->deleted_at);
        $this->assertNull(Cache::get('link-intent:'.$mine['hash']));
        $this->assertSame(1, DB::table('audit_events')->where('action', 'admin.user_block')->count());
    }

    public function test_failed_required_admin_audit_admission_preserves_private_handoff_and_file(): void
    {
        $owner = User::factory()->create();
        $mine = $this->claimed($owner, 'admission-private');
        $export = $this->artifact($owner);
        $this->prepare('admin', $owner);
        $before = $this->sqlSnapshot();
        DB::listen(static function (QueryExecuted $query): void {
            if (! str_starts_with($query->sql, 'insert into "audit_outbox"')) {
                return;
            }
            foreach ($query->bindings as $binding) {
                $event = is_string($binding) ? json_decode($binding, true) : null;
                if (is_array($event) && ($event['action'] ?? '') === 'admin.user_block') {
                    throw new \RuntimeException('Fixture required audit admission failed');
                }
            }
        });
        $this->patchJson('/api/v1/admin/users/'.$owner->id, ['blocked' => true])->assertServerError();
        $this->assertSame($before, $this->sqlSnapshot());
        $this->retained($owner, $mine);
        $this->counters($mine, 1);
        Storage::disk('local')->assertExists($export->artifact_path);
    }
}
