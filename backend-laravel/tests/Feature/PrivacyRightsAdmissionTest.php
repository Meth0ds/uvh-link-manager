<?php

namespace Tests\Feature;

use App\Jobs\DeliverMailOutboxJob;
use App\Models\User;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\MfaFreshness;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Actual HTTP admission and real DB interleavings, exclusively on guarded *_test. */
final class PrivacyRightsAdmissionTest extends TestCase
{
    private const BODY = 'Datos privados de esta solicitud: Málaga y revisión de mi cuenta.';

    private bool $interruptAudit = false;

    private bool $interruptMail = false;

    private array $auditLevels = [];

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, privacy_rights_requests, privacy_rights_messages, notifications, audit_events, audit_outbox, mail_outbox, operational_metrics RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'privacy-admission-csrf')->withHeader('X-CSRF-Token', 'privacy-admission-csrf');
        $this->freezeSecond();
        Queue::fake();
        DB::listen(function (QueryExecuted $query): void {
            $sql = strtolower($query->sql);
            if (str_starts_with($sql, 'insert into "audit_outbox"')) {
                $this->auditLevels[] = $query->connection->transactionLevel();
                if ($this->interruptAudit) {
                    throw new \RuntimeException('Fixture: privacy exact audit interrupted after insert');
                }
            }
            if ($this->interruptMail && str_starts_with($sql, 'insert into "mail_outbox"')) {
                throw new \RuntimeException('Fixture: privacy mail interrupted after insert');
            }
        });
    }

    public static function staleContexts(): array
    {
        $cases = [];
        foreach (['index', 'store', 'respond', 'cancel', 'admin-index', 'admin-action'] as $surface) {
            foreach (['revoked', 'expired', 'session-version', 'foreign-owner', 'blocked', 'unverified', 'account-version'] as $state) {
                $cases[$surface.' '.$state] = [$surface, $state];
            }
        }
        foreach (['admin-index', 'admin-action'] as $surface) {
            foreach (['role', 'mfa-disabled', 'mfa-proof-null', 'mfa-expired', 'rotated-account-and-session'] as $state) {
                $cases[$surface.' '.$state] = [$surface, $state];
            }
        }

        return $cases;
    }

    #[DataProvider('staleContexts')]
    public function test_authority_is_revalidated_after_middleware_hydration(string $surface, string $state): void
    {
        [$actor, $sessionId, $target, $id] = $this->fixture(str_starts_with($surface, 'admin'));
        $before = $this->snapshot();
        $injected = false;
        DB::listen(static function (QueryExecuted $query) use ($actor, $sessionId, $target, $state, &$injected): void {
            $sql = strtolower($query->sql);
            if ($injected || ! str_starts_with($sql, 'select * from "users"') || str_contains($sql, 'for update')) {
                return;
            }
            // The SELECT has fetched the former owner. Middleware receives
            // that old authorized snapshot; the controller sees the new state.
            $injected = true;
            match ($state) {
                'revoked' => DB::table('sessions')->where('id', $sessionId)->update(['revoked_at' => now()]),
                'expired' => DB::table('sessions')->where('id', $sessionId)->update(['expires_at' => now()]),
                'session-version' => DB::table('sessions')->where('id', $sessionId)->update(['security_version' => 2]),
                'foreign-owner' => DB::table('sessions')->where('id', $sessionId)->update(['user_id' => $target->id]),
                'blocked' => DB::table('users')->where('id', $actor->id)->update(['deleted_at' => now()]),
                'unverified' => DB::table('users')->where('id', $actor->id)->update(['email_verified_at' => null]),
                'account-version' => DB::table('users')->where('id', $actor->id)->update(['security_version' => 2]),
                'role' => DB::table('users')->where('id', $actor->id)->update(['is_admin' => false]),
                'mfa-disabled' => DB::table('users')->where('id', $actor->id)->update(['mfa_enabled' => false]),
                'mfa-proof-null' => DB::table('sessions')->where('id', $sessionId)->update(['mfa_verified_at' => null]),
                'mfa-expired' => DB::table('sessions')->where('id', $sessionId)->update(['mfa_verified_at' => now()->subMinutes(MfaFreshness::windowMinutes())]),
                'rotated-account-and-session' => self::rotateBoth($actor, $sessionId),
            };
        });
        $response = $this->requestFor($surface, $id);
        $this->assertTrue($injected, 'The post-hydration interleaving must execute');
        $expected = in_array($surface, ['index', 'admin-index'], true) ? 401 : 409;
        if ($surface === 'admin-index' && in_array($state, ['role', 'mfa-disabled', 'mfa-proof-null', 'mfa-expired'], true)) {
            $expected = 403;
        }
        $this->assertSame($expected, $response->status(), $surface.' '.$state.' HTTP '.$response->status());
        $response->assertJsonMissingPath('requests')->assertJsonMissingPath('request')->assertCookieMissing('uvh_session');
        $this->assertSame($before, $this->snapshot());
        Queue::assertNothingPushed();
    }

    public static function commands(): array
    {
        return [['store'], ['respond'], ['cancel'], ['admin-action']];
    }

    public static function auditFailures(): array
    {
        $cases = [];
        foreach (self::commands() as [$command]) {
            foreach (['interrupted', 'absent'] as $mode) {
                $cases[$command.' '.$mode] = [$command, $mode];
            }
        }

        return $cases;
    }

    #[DataProvider('auditFailures')]
    public function test_exact_audit_admission_failure_rolls_back_case_messages_and_notices(string $command, string $mode): void
    {
        [, , , $id] = $this->fixture($command === 'admin-action');
        $before = $this->snapshot();
        $this->interruptAudit = $mode === 'interrupted';
        if ($mode === 'absent') {
            Schema::rename('audit_outbox', 'audit_outbox_privacy_absent');
        }
        try {
            $response = $this->requestFor($command, $id);
        } finally {
            $this->interruptAudit = false;
            if ($mode === 'absent') {
                Schema::rename('audit_outbox_privacy_absent', 'audit_outbox');
            }
        }
        $this->assertSame($before, $this->snapshot(), 'Exact audit failure must roll back the case; HTTP '.$response->status());
        $response->assertServerError();
        Queue::assertNothingPushed();
        $this->requestFor($command, $id)->assertSuccessful();
        $this->assertDatabaseCount('audit_events', 1);
        $this->assertSame(self::action($command), DB::table('audit_events')->value('action'));
    }

    #[DataProvider('commands')]
    public function test_history_outage_retains_exact_recoverable_event_without_personal_text(string $command): void
    {
        [$actor, , , $id] = $this->fixture($command === 'admin-action');
        Schema::rename('audit_events', 'audit_events_privacy_absent');
        try {
            $response = $this->requestFor($command, $id)->assertSuccessful();
            $this->assertDatabaseCount('audit_outbox', 1);
            $event = json_decode(DB::table('audit_outbox')->value('event'), true, 32, JSON_THROW_ON_ERROR);
            $requestId = $command === 'store' ? $response->json('request.id') : $id;
            $this->assertSame($actor->id, $event['user_id']);
            $this->assertSame(self::action($command), $event['action']);
            $this->assertSame('privacy_right', $event['resource_type']);
            $this->assertSame((string) $requestId, $event['resource_id']);
            $this->assertStringNotContainsString(self::BODY, json_encode($event, JSON_THROW_ON_ERROR));
            $this->assertSame([1], $this->auditLevels);
        } finally {
            Schema::rename('audit_events_privacy_absent', 'audit_events');
        }
        $this->assertTrue(Audit::drain());
        $this->assertTrue(Audit::drain());
        $this->assertDatabaseCount('audit_events', 1);
        $this->assertDatabaseCount('audit_outbox', 0);
    }

    public static function outerTransactions(): array
    {
        $cases = [];
        foreach (self::commands() as [$command]) {
            foreach ([false, true] as $commit) {
                $cases[$command.($commit ? ' commits' : ' rolls back')] = [$command, $commit];
            }
        }

        return $cases;
    }

    #[DataProvider('outerTransactions')]
    public function test_case_audit_and_mail_callbacks_follow_outer_commit(string $command, bool $commit): void
    {
        [, , , $id] = $this->fixture($command === 'admin-action');
        $before = $this->snapshot();
        DB::beginTransaction();
        try {
            $this->requestFor($command, $id)->assertSuccessful();
            $this->assertSame([2], $this->auditLevels);
            $this->assertDatabaseCount('audit_events', 0);
            $this->assertDatabaseCount('audit_outbox', 1);
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
            $this->assertSame($before, $this->snapshot());
            Queue::assertNothingPushed();
        } else {
            $this->assertDatabaseCount('audit_events', 1);
            $this->assertDatabaseCount('audit_outbox', 0);
            if ($command === 'respond') {
                Queue::assertNothingPushed();
            } else {
                Queue::assertPushed(DeliverMailOutboxJob::class, 1);
            }
        }
    }

    #[DataProvider('commands')]
    public function test_success_keeps_contracts_and_encrypted_messages(string $command): void
    {
        [$actor, , $target, $id] = $this->fixture($command === 'admin-action');
        $response = $this->requestFor($command, $id)->assertSuccessful();
        $requestId = $command === 'store' ? $response->json('request.id') : $id;
        $expectedStatus = match ($command) {
            'store' => 'submitted', 'respond', 'admin-action' => 'in_progress', 'cancel' => 'cancelled',
        };
        $row = DB::table('privacy_rights_requests')->where('id', $requestId)->first();
        $this->assertSame($expectedStatus, $row->status);
        $this->assertSame($command === 'admin-action' ? $target->id : $actor->id, $row->user_id);
        $this->assertSame([1], $this->auditLevels);
        $this->assertSame(self::action($command), DB::table('audit_events')->value('action'));
        if (in_array($command, ['store', 'respond'], true)) {
            $message = DB::table('privacy_rights_messages')->where('request_id', $requestId)->orderByDesc('id')->first();
            $this->assertNotSame(self::BODY, $message->encrypted_body);
            $this->assertSame(self::BODY, UvhCrypto::decryptAtRest($message->encrypted_body));
        }
        foreach (DB::table('mail_outbox')->get() as $mail) {
            $this->assertStringNotContainsString(self::BODY, UvhCrypto::decryptAtRest($mail->encrypted_envelope));
            $this->assertSame('privacy_right', $mail->resource_type);
            $this->assertSame((string) $requestId, $mail->resource_id);
            $this->assertSame($row->generation_hash, $mail->resource_generation);
        }
    }

    public static function noticeCommands(): array
    {
        return [['store'], ['cancel'], ['admin-action']];
    }

    #[DataProvider('noticeCommands')]
    public function test_mail_failure_after_real_insert_rolls_back_case_inbox_and_audit(string $command): void
    {
        [, , , $id] = $this->fixture($command === 'admin-action');
        $before = $this->snapshot();
        $this->interruptMail = true;
        $response = $this->requestFor($command, $id);
        $this->interruptMail = false;
        $response->assertStatus(503);
        $this->assertSame($before, $this->snapshot());
        Queue::assertNothingPushed();
        $this->requestFor($command, $id)->assertSuccessful();
        $this->assertDatabaseCount('audit_events', 1);
        $this->assertDatabaseCount('mail_outbox', 1);
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
    }

    public static function adminActions(): array
    {
        $cases = [];
        foreach (['start_review', 'request_information', 'complete', 'reject', 'extend'] as $action) {
            foreach (['success', 'audit-failure', 'mail-failure'] as $mode) {
                $cases[$action.' '.$mode] = [$action, $mode];
            }
        }

        return $cases;
    }

    #[DataProvider('adminActions')]
    public function test_all_admin_decisions_preserve_atomicity_and_state_contract(string $action, string $mode): void
    {
        [$actor, , $target, $id] = $this->fixture(true);
        $before = $this->snapshot();
        $old = DB::table('privacy_rights_requests')->where('id', $id)->first();
        $this->interruptAudit = $mode === 'audit-failure';
        $this->interruptMail = $mode === 'mail-failure';
        $response = $this->postJson('/api/v1/admin/privacy-requests/'.$id.'/action', [
            'action' => $action, 'message' => self::BODY, 'reasonCode' => 'complexity',
        ]);
        if ($mode !== 'success') {
            $this->assertSame($before, $this->snapshot());
            $response->assertStatus($mode === 'mail-failure' ? 503 : 500);
            Queue::assertNothingPushed();

            return;
        }
        $status = match ($action) {
            'start_review' => 'in_progress', 'request_information' => 'waiting_user',
            'complete' => 'completed', 'reject' => 'rejected', 'extend' => 'submitted',
        };
        $response->assertExactJson(['ok' => true, 'status' => $status]);
        $row = DB::table('privacy_rights_requests')->where('id', $id)->first();
        $this->assertSame($actor->id, $row->assigned_admin_id);
        $this->assertNotSame($old->generation_hash, $row->generation_hash);
        $this->assertSame($old->due_at, $row->due_at);
        if ($action === 'extend') {
            $this->assertSame('complexity', $row->extension_reason_code);
            $this->assertNotNull($row->extended_until);
        }
        if (in_array($action, ['complete', 'reject'], true)) {
            $this->assertNotNull($row->completed_at);
        }
        $message = DB::table('privacy_rights_messages')->where('request_id', $id)->orderByDesc('id')->first();
        $this->assertSame('admin', $message->author_role);
        $this->assertSame($actor->id, $message->author_user_id);
        $this->assertSame(self::BODY, UvhCrypto::decryptAtRest($message->encrypted_body));
        $audit = DB::table('audit_events')->sole();
        $metadata = json_decode($audit->metadata, true, 32, JSON_THROW_ON_ERROR);
        $this->assertSame('admin.privacy_action', $audit->action);
        $this->assertSame($action, $metadata['action']);
        $this->assertArrayNotHasKey('message', $metadata);
        $this->assertSame($target->id, DB::table('notifications')->value('user_id'));
        $this->assertDatabaseCount('mail_outbox', 1);
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
    }

    public static function closedCases(): array
    {
        $cases = [];
        foreach (['respond', 'cancel', 'admin-action'] as $command) {
            foreach (['completed', 'rejected', 'cancelled'] as $status) {
                $cases[$command.' '.$status] = [$command, $status];
            }
        }

        return $cases;
    }

    #[DataProvider('closedCases')]
    public function test_closed_cases_cannot_be_changed_or_notified_again(string $command, string $status): void
    {
        [, , , $id] = $this->fixture($command === 'admin-action');
        DB::table('privacy_rights_requests')->where('id', $id)->update(['status' => $status]);
        $before = $this->snapshot();
        $this->requestFor($command, $id)->assertStatus(409);
        $this->assertSame($before, $this->snapshot());
        Queue::assertNothingPushed();
    }

    public static function privateCaseCommands(): array
    {
        return [['respond'], ['cancel']];
    }

    #[DataProvider('privateCaseCommands')]
    public function test_foreign_case_identity_is_not_authority(string $command): void
    {
        [, , $target, $id] = $this->fixture();
        DB::table('privacy_rights_requests')->where('id', $id)->update(['user_id' => $target->id]);
        $before = $this->snapshot();
        $this->requestFor($command, $id)->assertNotFound()->assertExactJson(['error' => 'Solicitud no encontrada']);
        $this->assertSame($before, $this->snapshot());
        Queue::assertNothingPushed();
    }

    public function test_active_duplicate_returns_owned_case_without_second_notice_or_audit(): void
    {
        [, , , $id] = $this->fixture();
        $before = $this->snapshot();
        $response = $this->postJson('/api/v1/auth/privacy-requests', ['type' => 'access', 'details' => self::BODY]);
        $response->assertStatus(409)->assertJsonPath('request.id', $id);
        $this->assertSame($before, $this->snapshot());
        Queue::assertNothingPushed();
    }

    public function test_message_limit_preserves_case_but_allows_cancellation(): void
    {
        [$actor, , , $id] = $this->fixture();
        for ($i = 0; $i < 19; $i++) {
            DB::table('privacy_rights_messages')->insert([
                'request_id' => $id, 'author_role' => 'user', 'author_user_id' => $actor->id,
                'encrypted_body' => UvhCrypto::encryptAtRest('Mensaje previo número '.$i), 'created_at' => now(),
            ]);
        }
        $before = $this->snapshot();
        $this->requestFor('respond', $id)->assertStatus(409);
        $this->assertSame($before, $this->snapshot());
        $this->requestFor('cancel', $id)->assertOk();
        $this->assertSame(20, DB::table('privacy_rights_messages')->where('request_id', $id)->count());
    }

    public function test_private_list_is_scoped_paginated_and_batches_messages_without_locks(): void
    {
        [$actor, , $target, $id] = $this->fixture();
        $this->insertCase($target, 'completed', now()->addDay());
        $second = $this->insertCase($actor, 'completed', now()->addDays(2));
        $third = $this->insertCase($actor, 'cancelled', now()->addDays(3));
        $messageQueries = [];
        $lockedReads = [];
        DB::listen(static function (QueryExecuted $query) use (&$messageQueries, &$lockedReads): void {
            if (str_starts_with(strtolower($query->sql), 'select') && str_contains($query->sql, '"privacy_rights_messages"')) {
                $messageQueries[] = $query->sql;
            }
            if (str_contains(strtolower($query->sql), 'for update')) {
                $lockedReads[] = $query->sql;
            }
        });
        $response = $this->getJson('/api/v1/auth/privacy-requests?perPage=2')->assertOk();
        $this->assertSame([$third, $second], array_column($response->json('requests'), 'id'));
        $response->assertJsonPath('total', 3)->assertJsonPath('page', 1)->assertJsonPath('perPage', 2);
        $this->assertCount(1, $messageQueries);
        $this->assertSame([], $lockedReads);
        foreach ($response->json('requests') as $row) {
            $this->assertArrayNotHasKey('email', $row);
            $this->assertArrayNotHasKey('userId', $row);
            $this->assertArrayNotHasKey('generation_hash', $row);
            $this->assertArrayNotHasKey('security_version', $row);
            $this->assertSame('Mensaje de fixture privado', $row['messages'][0]['body']);
        }
        $messageQueries = [];
        $this->getJson('/api/v1/auth/privacy-requests?page=99&perPage=2')->assertOk()->assertJsonPath('requests', []);
        $this->assertSame([], $messageQueries);
        $this->assertDatabaseHas('privacy_rights_requests', ['id' => $id, 'user_id' => $actor->id]);
    }

    public function test_admin_list_orders_active_deadlines_before_history_and_batches_messages(): void
    {
        [, , $target, $id] = $this->fixture(true);
        $historical = $this->insertCase($target, 'completed', now()->subDay());
        $overdue = $this->insertCase($target, 'in_progress', now()->subDays(2), 'rectification');
        $messages = 0;
        DB::listen(static function (QueryExecuted $query) use (&$messages): void {
            if (str_starts_with(strtolower($query->sql), 'select') && str_contains($query->sql, '"privacy_rights_messages"')) {
                $messages++;
            }
        });
        $response = $this->getJson('/api/v1/admin/privacy-requests')->assertOk();
        $this->assertSame([$overdue, $id, $historical], array_column($response->json('requests'), 'id'));
        $response->assertJsonPath('requests.0.overdue', true)->assertJsonPath('requests.0.email', $target->email);
        $this->assertSame(1, $messages);
        $this->getJson('/api/v1/admin/privacy-requests?status=completed')->assertOk()->assertJsonPath('total', 1);
        $this->getJson('/api/v1/admin/privacy-requests?status=invalid')->assertStatus(422);
        $this->getJson('/api/v1/admin/privacy-requests?type=invalid')->assertStatus(422);
    }

    public function test_corrupt_message_is_redacted_without_failing_private_list(): void
    {
        [, , , $id] = $this->fixture();
        DB::table('privacy_rights_messages')->where('request_id', $id)->update(['encrypted_body' => 'enc:v1:invalid-fixture-ciphertext']);
        $this->getJson('/api/v1/auth/privacy-requests')->assertOk()->assertJsonPath('requests.0.messages.0.body', null);
        $this->assertDatabaseCount('audit_events', 0);
        Queue::assertNothingPushed();
    }

    private function insertCase(User $user, string $status, \DateTimeInterface $deadline, string $type = 'access'): int
    {
        $id = DB::table('privacy_rights_requests')->insertGetId([
            'user_id' => $user->id, 'security_version' => 1, 'type' => $type, 'status' => $status,
            'generation_hash' => Ids::sha256Hex(Ids::randomToken(32)), 'identity_verified_at' => now(),
            'due_at' => $deadline, 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('privacy_rights_messages')->insert([
            'request_id' => $id, 'author_role' => 'user', 'author_user_id' => $user->id,
            'encrypted_body' => UvhCrypto::encryptAtRest('Mensaje de fixture privado'), 'created_at' => now(),
        ]);

        return $id;
    }

    /** @return array{User, string, User, int} */
    private function fixture(bool $admin = false): array
    {
        $actor = User::factory()->create(['is_admin' => $admin, 'mfa_enabled' => $admin]);
        $target = User::factory()->create();
        $owner = $admin ? $target : $actor;
        $id = DB::table('privacy_rights_requests')->insertGetId([
            'user_id' => $owner->id, 'security_version' => 1, 'type' => 'access',
            'status' => $admin ? 'submitted' : 'waiting_user',
            'generation_hash' => Ids::sha256Hex('fixture-case'),
            'identity_verified_at' => now(), 'due_at' => now()->addMonthNoOverflow(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('privacy_rights_messages')->insert([
            'request_id' => $id, 'author_role' => 'user', 'author_user_id' => $owner->id,
            'encrypted_body' => UvhCrypto::encryptAtRest('Mensaje inicial reservado para el titular.'), 'created_at' => now(),
        ]);
        $token = SessionManager::create($actor->id, Request::create('/'), 1, $admin);
        $this->withCookie('uvh_session', $token)->withServerVariables(['REMOTE_ADDR' => '192.0.2.18']);

        return [$actor, Ids::sha256Hex($token), $target, $id];
    }

    private function requestFor(string $surface, int $id): TestResponse
    {
        return match ($surface) {
            'index' => $this->getJson('/api/v1/auth/privacy-requests'),
            'store' => $this->postJson('/api/v1/auth/privacy-requests', ['type' => 'rectification', 'details' => self::BODY]),
            'respond' => $this->postJson('/api/v1/auth/privacy-requests/'.$id.'/respond', ['message' => self::BODY]),
            'cancel' => $this->postJson('/api/v1/auth/privacy-requests/'.$id.'/cancel'),
            'admin-index' => $this->getJson('/api/v1/admin/privacy-requests'),
            'admin-action' => $this->postJson('/api/v1/admin/privacy-requests/'.$id.'/action', ['action' => 'start_review']),
        };
    }

    private static function action(string $command): string
    {
        return match ($command) {
            'store' => 'privacy.request_submitted', 'respond' => 'privacy.user_responded',
            'cancel' => 'privacy.request_cancelled', 'admin-action' => 'admin.privacy_action',
        };
    }

    private static function rotateBoth(User $actor, string $sessionId): void
    {
        DB::table('users')->where('id', $actor->id)->update(['security_version' => 2]);
        DB::table('sessions')->where('id', $sessionId)->update(['security_version' => 2]);
    }

    /** @return array<string, string> */
    private function snapshot(): array
    {
        $state = [];
        foreach (['privacy_rights_requests', 'privacy_rights_messages', 'notifications', 'audit_events', 'audit_outbox', 'mail_outbox'] as $table) {
            $state[$table] = DB::table($table)->orderBy('id')->get()->toJson();
        }

        return $state;
    }
}
