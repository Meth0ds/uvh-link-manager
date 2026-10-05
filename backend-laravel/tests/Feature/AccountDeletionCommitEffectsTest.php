<?php

namespace Tests\Feature;

use App\Models\AccountDeletionRequest;
use App\Models\User;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\LinkIntentRegistry;
use App\Support\SessionManager;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Testing\TestResponse;
use Mockery;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** HTTP-issued/claimed handoffs, real guarded SQL and independent array cache. */
final class AccountDeletionCommitEffectsTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox, mail_outbox, notifications, operational_metrics RESTART IDENTITY CASCADE');
        Queue::fake();
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'deletion-commit-csrf')->withHeader('X-CSRF-Token', 'deletion-commit-csrf');
        $this->freezeSecond();
    }

    protected function tearDown(): void
    {
        while (DB::transactionLevel() > 0) {
            DB::rollBack();
        }
        parent::tearDown();
    }

    private function claimed(User $user, string $path): array
    {
        $raw = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true);
        $this->withCookie('uvh_session', $raw);
        $issued = $this->postJson('/api/v1/link-intents', ['destination' => 'https://example.com/'.$path])->assertCreated();
        $token = $issued->json('intent');
        $this->assertIsString($token);
        $this->postJson('/api/v1/link-intents/claim', ['intent' => $token])->assertOk()->assertJsonPath('destination', 'https://example.com/'.$path);
        $hash = Ids::sha256Hex($token);
        $record = Cache::get('link-intent:'.$hash);
        $this->assertIsArray($record);
        $this->assertSame($user->id, $record['claimed_by']);
        $this->assertDatabaseHas('link_intent_claims', ['intent_hash' => $hash, 'user_id' => $user->id]);

        return ['hash' => $hash, 'record' => $record, 'session' => Ids::sha256Hex($raw), 'token' => $token];
    }

    private function pending(User $user): array
    {
        $token = Ids::randomToken(32);
        $row = AccountDeletionRequest::create([
            'user_id' => $user->id, 'security_version' => (int) $user->security_version,
            'status' => 'requested', 'confirmation_token_hash' => Ids::sha256Hex($token),
            'confirmation_expires_at' => now()->addHour(),
        ]);

        return [$row, $token];
    }

    private function confirm(string $token): TestResponse
    {
        return $this->postJson('/api/v1/auth/account-deletion/confirm', ['token' => $token]);
    }

    private function retained(User $user, array $intent): void
    {
        $this->assertSame($intent['record'], Cache::get('link-intent:'.$intent['hash']));
        $this->assertDatabaseHas('link_intent_claims', ['intent_hash' => $intent['hash'], 'user_id' => $user->id]);
    }

    private function counter(array $intent, int $expected): void
    {
        $this->assertSame($expected, Cache::get($intent['record']['counter_key']));
        $this->assertSame($expected, Cache::get($intent['record']['global_counter_key']));
    }

    private function reverted(User $user, AccountDeletionRequest $row, array $intent): void
    {
        $this->assertNull($user->refresh()->deleted_at);
        $this->assertSame(1, $user->security_version);
        $this->assertSame('requested', $row->refresh()->status);
        $this->assertNull(DB::table('sessions')->where('id', $intent['session'])->value('revoked_at'));
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertDatabaseCount('audit_events', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->retained($user, $intent);
        $this->counter($intent, 1);
        Queue::assertNothingPushed();
    }

    public function test_cache_and_counters_are_unchanged_until_outer_commit_then_only_owner_is_revoked(): void
    {
        $user = User::factory()->create();
        $other = User::factory()->create();
        $mine = $this->claimed($user, 'private-a');
        $theirs = $this->claimed($other, 'private-b');
        [$row, $token] = $this->pending($user);
        DB::beginTransaction();
        $this->confirm($token)->assertOk()->assertJsonPath('current', false)->assertCookieMissing('uvh_session');
        $this->assertSame('scheduled', $row->refresh()->status);
        $this->assertNotNull($user->refresh()->deleted_at);
        $this->retained($user, $mine);
        $this->retained($other, $theirs);
        $this->counter($mine, 2);
        $this->assertSame(0, DB::table('audit_events')->where('action', 'account.deletion_link_intents_reconciled')->count());
        DB::commit();
        $this->assertNull(Cache::get('link-intent:'.$mine['hash']));
        $this->assertDatabaseMissing('link_intent_claims', ['intent_hash' => $mine['hash']]);
        $this->retained($other, $theirs);
        $this->counter($theirs, 1);
        $this->assertNull($other->refresh()->deleted_at);
        $this->assertNull(DB::table('sessions')->where('id', $theirs['session'])->value('revoked_at'));
        $this->postJson('/api/v1/link-intents/claim', ['intent' => $theirs['token']])->assertOk()->assertJsonPath('destination', 'https://example.com/private-b');
        $event = DB::table('audit_events')->where('action', 'account.deletion_link_intents_reconciled')->first();
        $this->assertNotNull($event);
        $metadata = json_decode($event->metadata, true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame(1, $metadata['link_intents_revoked']);
        $this->assertSame(0, $metadata['link_intents_busy']);
        $this->assertStringNotContainsString('private-a', $event->metadata);
        $this->assertSame(1, DB::table('mail_outbox')->count());
    }

    public function test_outer_rollback_preserves_the_private_destination_and_admission_counters(): void
    {
        $user = User::factory()->create();
        $intent = $this->claimed($user, 'rollback-private');
        [$row, $token] = $this->pending($user);
        DB::beginTransaction();
        $this->confirm($token)->assertOk();
        DB::rollBack();
        $this->reverted($user, $row, $intent);
        $this->postJson('/api/v1/link-intents/claim', ['intent' => $intent['token']])->assertOk()->assertJsonPath('destination', 'https://example.com/rollback-private');
    }

    public function test_rolled_back_savepoint_does_not_revoke_cache_when_outer_transaction_commits(): void
    {
        $user = User::factory()->create();
        $intent = $this->claimed($user, 'savepoint-private');
        [$row, $token] = $this->pending($user);
        DB::beginTransaction();
        DB::beginTransaction();
        $this->confirm($token)->assertOk();
        DB::rollBack();
        DB::commit();
        $this->reverted($user, $row, $intent);
    }

    public function test_normal_commit_revokes_once_without_reviving_bearer_on_cancellation(): void
    {
        $user = User::factory()->create();
        $intent = $this->claimed($user, 'normal-private');
        [$row, $token] = $this->pending($user);
        $this->confirm($token)->assertOk()->assertJsonPath('current', true);
        $this->assertSame('scheduled', $row->refresh()->status);
        $this->assertNull(Cache::get('link-intent:'.$intent['hash']));
        $this->counter($intent, 0);
        $this->assertSame(['revoked' => 0, 'busy' => 0], LinkIntentRegistry::revokeForUser($user->id));
        $this->counter($intent, 0);
        $cancel = Ids::randomToken(32);
        $row->update(['cancel_token_hash' => Ids::sha256Hex($cancel)]);
        $this->postJson('/api/v1/auth/account-deletion/cancel', ['token' => $cancel])->assertOk();
        $this->assertNull($user->refresh()->deleted_at);
        $this->assertNull(Cache::get('link-intent:'.$intent['hash']));
        $this->assertDatabaseMissing('link_intent_claims', ['intent_hash' => $intent['hash']]);
    }

    public static function cacheFailures(): array
    {
        return array_map(static fn ($value) => [$value], ['lock-busy', 'lock-throw', 'read-throw', 'forget-false', 'forget-throw', 'release-throw']);
    }

    #[DataProvider('cacheFailures')]
    public function test_committed_suspension_survives_cache_failure_and_preserves_recoverable_index(string $failure): void
    {
        $user = User::factory()->create();
        $intent = $this->claimed($user, 'failure-private');
        [$row, $token] = $this->pending($user);
        $cache = Cache::getFacadeRoot();
        $held = null;
        if ($failure === 'lock-busy') {
            $held = Cache::lock('link-intent-lock:'.$intent['hash'], 5);
            $this->assertTrue($held->get());
        } else {
            $mock = Mockery::mock($cache)->makePartial();
            if ($failure === 'lock-throw') {
                $mock->shouldReceive('lock')->with('link-intent-lock:'.$intent['hash'], 5)->once()->andThrow(new \RuntimeException('Fixture intent lock unavailable'));
            } elseif ($failure === 'release-throw') {
                $lock = Mockery::mock();
                $lock->shouldReceive('get')->once()->andReturnTrue();
                $lock->shouldReceive('release')->once()->andThrow(new \RuntimeException('Fixture release failed'));
                $mock->shouldReceive('lock')->with('link-intent-lock:'.$intent['hash'], 5)->once()->andReturn($lock);
            } else {
                $expectation = $mock->shouldReceive($failure === 'read-throw' ? 'get' : 'forget')->with('link-intent:'.$intent['hash'])->once();
                if ($failure === 'forget-false') {
                    $expectation->andReturnFalse();
                } else {
                    $expectation->andThrow(new \RuntimeException('Fixture cache operation failed'));
                }
            }
            Cache::swap($mock);
        }
        try {
            $this->confirm($token)->assertOk()->assertJsonPath('current', true);
        } finally {
            $held?->release();
            Cache::swap($cache);
        }
        $this->assertNotNull($user->refresh()->deleted_at);
        $this->assertSame('scheduled', $row->refresh()->status);
        if ($failure === 'release-throw') {
            $this->assertNull(Cache::get('link-intent:'.$intent['hash']));
            $this->assertDatabaseMissing('link_intent_claims', ['intent_hash' => $intent['hash']]);
            $this->counter($intent, 0);
        } else {
            $this->retained($user, $intent);
            $this->counter($intent, 1);
            $this->assertSame(['revoked' => 1, 'busy' => 0], LinkIntentRegistry::revokeForUser($user->id));
            $this->counter($intent, 0);
        }
        $event = DB::table('audit_events')->where('action', 'account.deletion_link_intents_reconciled')->first();
        $this->assertNotNull($event);
        $metadata = json_decode($event->metadata, true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame($failure === 'release-throw' ? 0 : 1, $metadata['link_intents_busy']);
        $this->assertSame($failure === 'release-throw' ? 1 : 0, $metadata['link_intents_revoked']);
    }

    public static function counterFailures(): array
    {
        return [['lock-busy'], ['put-false'], ['put-throw']];
    }

    #[DataProvider('counterFailures')]
    public function test_secondary_counter_cleanup_failure_does_not_revive_committed_handoff(string $failure): void
    {
        $user = User::factory()->create();
        $intent = $this->claimed($user, 'counter-private');
        [$row, $token] = $this->pending($user);
        $cache = Cache::getFacadeRoot();
        $held = null;
        if ($failure === 'lock-busy') {
            $held = Cache::lock('link-intent-active:global:lock', 5);
            $this->assertTrue($held->get());
        } else {
            $mock = Mockery::mock($cache)->makePartial();
            $expectation = $mock->shouldReceive('put')->with($intent['record']['counter_key'], 0, Mockery::any())->once();
            if ($failure === 'put-false') {
                $expectation->andReturnFalse();
            } else {
                $expectation->andThrow(new \RuntimeException('Fixture counter store unavailable'));
            }
            Cache::swap($mock);
        }
        try {
            $this->confirm($token)->assertOk();
        } finally {
            $held?->release();
            Cache::swap($cache);
        }
        $this->assertSame('scheduled', $row->refresh()->status);
        $this->assertNotNull($user->refresh()->deleted_at);
        $this->assertNull(Cache::get('link-intent:'.$intent['hash']));
        // Counter release is bounded best effort; the private bearer is gone.
        // A retry of the SQL inverse row cannot decrement an already gone record.
        $this->assertSame(1, Cache::get($intent['record']['counter_key']));
        $this->assertSame(['revoked' => 0, 'busy' => 0], LinkIntentRegistry::revokeForUser($user->id));
        $this->assertDatabaseMissing('link_intent_claims', ['intent_hash' => $intent['hash']]);
        $this->assertSame(1, Cache::get($intent['record']['counter_key']));
    }

    public function test_sql_cleanup_failure_keeps_inverse_row_and_retry_does_not_decrement_twice(): void
    {
        $user = User::factory()->create();
        $intent = $this->claimed($user, 'sql-private');
        [$row, $token] = $this->pending($user);
        $cache = Cache::getFacadeRoot();
        $mock = Mockery::mock($cache)->makePartial();
        $mock->shouldReceive('forget')->with('link-intent:'.$intent['hash'])->once()->andReturnUsing(static function ($key) use ($cache): bool {
            $deleted = $cache->forget($key);
            Schema::rename('link_intent_claims', 'link_intent_claims_unavailable');

            return $deleted;
        });
        Cache::swap($mock);
        try {
            $this->confirm($token)->assertOk();
            $this->assertSame('scheduled', $row->refresh()->status);
            $this->assertNull($cache->get('link-intent:'.$intent['hash']));
            $this->assertDatabaseHas('link_intent_claims_unavailable', ['intent_hash' => $intent['hash']]);
        } finally {
            Cache::swap($cache);
            if (Schema::hasTable('link_intent_claims_unavailable')) {
                Schema::rename('link_intent_claims_unavailable', 'link_intent_claims');
            }
        }
        $this->counter($intent, 0);
        $this->assertSame(['revoked' => 0, 'busy' => 0], LinkIntentRegistry::revokeForUser($user->id));
        $this->assertDatabaseMissing('link_intent_claims', ['intent_hash' => $intent['hash']]);
        $this->counter($intent, 0);
    }

    public function test_failed_required_suspension_audit_admission_leaves_claimed_destination_usable(): void
    {
        $user = User::factory()->create();
        $intent = $this->claimed($user, 'admission-private');
        [$row, $token] = $this->pending($user);
        DB::listen(static function (QueryExecuted $query): void {
            if (! str_starts_with($query->sql, 'insert into "audit_outbox"')) {
                return;
            }
            foreach ($query->bindings as $binding) {
                $event = is_string($binding) ? json_decode($binding, true) : null;
                if (is_array($event) && ($event['action'] ?? '') === 'account.deletion_scheduled') {
                    throw new \RuntimeException('Fixture required audit admission failed');
                }
            }
        });
        $this->confirm($token)->assertServerError();
        $this->reverted($user, $row, $intent);
    }

    public function test_outer_commit_is_not_poisoned_by_best_effort_reconciliation_audit_failure(): void
    {
        $user = User::factory()->create();
        $intent = $this->claimed($user, 'audit-private');
        [$row, $token] = $this->pending($user);
        $failed = false;
        DB::listen(static function (QueryExecuted $query) use (&$failed): void {
            if (! str_starts_with($query->sql, 'insert into "audit_outbox"')) {
                return;
            }
            foreach ($query->bindings as $binding) {
                $event = is_string($binding) ? json_decode($binding, true) : null;
                if (is_array($event) && ($event['action'] ?? '') === 'account.deletion_link_intents_reconciled') {
                    $failed = true;
                    throw new \RuntimeException('Fixture reconciliation audit unavailable');
                }
            }
        });
        DB::beginTransaction();
        $this->confirm($token)->assertOk();
        $this->assertFalse($failed, 'Reconciliation has not run before the outer commit');
        DB::commit();
        $this->assertTrue($failed);
        $this->assertNotNull($user->refresh()->deleted_at);
        $this->assertSame('scheduled', $row->refresh()->status);
        $this->assertNull(Cache::get('link-intent:'.$intent['hash']));
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.deletion_scheduled')->count());
        $this->assertDatabaseCount('audit_outbox', 0);
    }

    public function test_history_failure_leaves_both_admitted_events_retryable_without_uncertain_response(): void
    {
        $user = User::factory()->create();
        $intent = $this->claimed($user, 'history-private');
        [$row, $token] = $this->pending($user);
        Schema::rename('audit_events', 'audit_events_unavailable');
        try {
            $this->confirm($token)->assertOk();
            $this->assertSame('scheduled', $row->refresh()->status);
            $this->assertNull(Cache::get('link-intent:'.$intent['hash']));
            $this->assertDatabaseCount('audit_outbox', 2);
        } finally {
            Schema::rename('audit_events_unavailable', 'audit_events');
        }
        Audit::drain();
        Audit::drain();
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.deletion_scheduled')->count());
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.deletion_link_intents_reconciled')->count());
    }
}
