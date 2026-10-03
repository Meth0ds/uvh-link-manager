<?php

namespace Tests\Feature;

use App\Models\Invitation;
use App\Models\User;
use App\Models\Webhook;
use App\Models\Workspace;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\PendingHandoff;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class WorkspaceAuditAtomicityTest extends TestCase
{
    private const PASSWORD = 'tiovivo-cobrizo-astilla-42';

    private const RECOVERY = 'ABCD2345EFGH6789';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, workspaces, audit_events, audit_outbox, mail_outbox, notifications RESTART IDENTITY CASCADE');
        config(['cache.default' => 'array']);
        $this->travelTo(now()->startOfSecond());
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'workspace-audit-csrf')->withHeader('X-CSRF-Token', 'workspace-audit-csrf');
        Queue::fake();
    }

    public static function operations(): array
    {
        return array_map(static fn (string $operation): array => [$operation], [
            'create', 'rename', 'role_change', 'ownership_transfer', 'member_remove', 'leave', 'delete',
            'invite', 'invitation_accepted', 'invitation_rejected', 'invitation_cancelled', 'invitation_resent',
        ]);
    }

    #[DataProvider('operations')]
    public function test_unavailable_admission_rolls_back_the_entire_business_operation(string $operation): void
    {
        $fixture = $this->fixture($operation);
        $before = $this->businessState();
        Schema::rename('audit_outbox', 'audit_outbox_unavailable');
        try {
            $this->mutate($operation, $fixture)->assertServerError();
        } finally {
            Schema::rename('audit_outbox_unavailable', 'audit_outbox');
        }
        $this->assertSame($before, $this->businessState());
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('audit_events', 0);
        Queue::assertNothingPushed();

        // A rejected admission must not spend the recovery code, invitation
        // bearer or SQL mail budget needed to retry the same operation.
        $this->mutate($operation, $fixture)->assertStatus($this->successStatus($operation));
        $this->assertSame(1, DB::table('audit_events')->where('action', 'workspace.'.$operation)->count());
    }

    #[DataProvider('operations')]
    public function test_interruption_after_durable_insert_still_rolls_back_the_business_operation(string $operation): void
    {
        $fixture = $this->fixture($operation);
        $before = $this->businessState();
        $interrupt = true;
        DB::listen(static function (QueryExecuted $event) use (&$interrupt): void {
            if ($interrupt && str_starts_with(strtolower($event->sql), 'insert') && str_contains($event->sql, '"audit_outbox"')) {
                throw new \RuntimeException('Fixture: interrupted after audit admission INSERT');
            }
        });
        try {
            $this->mutate($operation, $fixture)->assertServerError();
        } finally {
            $interrupt = false;
        }
        $this->assertSame($before, $this->businessState());
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('audit_events', 0);
        Queue::assertNothingPushed();
    }

    #[DataProvider('operations')]
    public function test_unavailable_history_keeps_the_exact_committed_event_recoverable(string $operation): void
    {
        $fixture = $this->fixture($operation);
        $before = $this->businessState();
        $levels = [];
        DB::listen(static function (QueryExecuted $event) use (&$levels): void {
            if (str_starts_with(strtolower($event->sql), 'insert') && str_contains($event->sql, '"audit_outbox"')) {
                $levels[] = $event->connection->transactionLevel();
            }
        });
        Schema::rename('audit_events', 'audit_events_unavailable');
        try {
            $response = $this->mutate($operation, $fixture)->assertStatus($this->successStatus($operation));
            $this->assertNotSame($before, $this->businessState());
            $this->assertSame([1], $levels);
            $this->assertDatabaseCount('audit_outbox', 1);
            $event = json_decode(DB::table('audit_outbox')->value('event'), true, flags: JSON_THROW_ON_ERROR);
            $workspaceId = $operation === 'create' ? $response->json('workspace.id') : $fixture['workspace']->id;
            $this->assertSame('workspace.'.$operation, $event['action']);
            $this->assertSame($fixture['actor']->id, $event['user_id']);
            $this->assertSame('workspace', $event['resource_type']);
            $this->assertSame((string) $workspaceId, $event['resource_id']);
            $this->assertSame($workspaceId, $event['workspace_id']);
            $metadata = json_decode($event['metadata'] ?? '{}', true, flags: JSON_THROW_ON_ERROR);
            $expected = match ($operation) {
                'role_change' => ['userId' => $fixture['target']->id, 'role' => 'viewer'],
                'ownership_transfer' => ['targetUserId' => $fixture['target']->id, 'factor' => 'recovery'],
                'member_remove' => ['userId' => $fixture['target']->id],
                'delete' => ['factor' => 'recovery'],
                'invite' => ['role' => 'viewer'],
                default => [],
            };
            unset($metadata['correlation_id']);
            $this->assertSame($expected, $metadata);
            $serialized = json_encode($event, JSON_THROW_ON_ERROR);
            foreach ([self::PASSWORD, self::RECOVERY, $fixture['bearer']] as $secret) {
                $this->assertStringNotContainsString($secret, $serialized);
            }
        } finally {
            Schema::rename('audit_events_unavailable', 'audit_events');
        }
        $this->assertTrue(Audit::drain());
        $this->assertTrue(Audit::drain());
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'workspace.'.$operation)->count());
    }

    public static function invitationDecisions(): array
    {
        return [['invitation_accepted', 'accept'], ['invitation_rejected', 'reject']];
    }

    public static function sessionChanges(): array
    {
        $cases = [];
        foreach (self::operations() as [$operation]) {
            foreach (['revoked', 'expired', 'generation', 'foreign', 'missing'] as $change) {
                $cases[$operation.' '.$change] = [$operation, $change];
            }
        }

        return $cases;
    }

    public static function nonexistentMemberIds(): array
    {
        return [['0'], ['000'], ['999999']];
    }

    #[DataProvider('nonexistentMemberIds')]
    public function test_nonexistent_member_ids_preserve_the_existing_rejection_contract(string $targetId): void
    {
        $fixture = $this->fixture('role_change');
        $before = $this->businessState();
        $this->patchJson('/api/v1/workspaces/'.$fixture['workspace']->id.'/members/'.$targetId, ['role' => 'viewer'])
            ->assertStatus(409)->assertJsonPath('error', 'La cuenta del miembro no está activa o verificada');
        $this->assertSame($before, $this->businessState());
        $this->assertDatabaseCount('audit_events', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
    }

    #[DataProvider('sessionChanges')]
    public function test_session_admitted_by_middleware_cannot_mutate_after_its_authority_changes(string $operation, string $change): void
    {
        $fixture = $this->fixture($operation);
        $before = $this->businessState();
        unset($before['mfa_proofs']);
        $armed = true;
        $intercepted = false;
        DB::listen(static function (QueryExecuted $event) use (&$armed, &$intercepted, $fixture, $change): void {
            if ($armed && str_contains($event->sql, '"users"') && str_contains($event->sql, 'for update')) {
                $armed = false;
                $intercepted = true;
                $query = DB::table('sessions')->where('user_id', $fixture['actor']->id);
                match ($change) {
                    'revoked' => $query->update(['revoked_at' => now()]),
                    'expired' => $query->update(['expires_at' => now()]),
                    'generation' => $query->update(['security_version' => 2]),
                    'foreign' => $query->update(['user_id' => $fixture['actor']->id === $fixture['owner']->id ? $fixture['recipient']->id : $fixture['owner']->id]),
                    'missing' => $query->delete(),
                };
            }
        });
        try {
            $response = $this->mutate($operation, $fixture);
        } finally {
            $armed = false;
        }
        $this->assertTrue($intercepted, 'The fixture must invalidate the session after middleware, before business writes');
        $response->assertStatus(409)->assertJsonPath('error', 'La sesión cambió. Vuelve a iniciar sesión');
        $after = $this->businessState();
        unset($after['mfa_proofs']);
        $this->assertSame($before, $after);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('audit_events', 0);
        Queue::assertNothingPushed();
    }

    public static function sessionBoundaries(): array
    {
        return [
            ['ownership_transfer', -1], ['ownership_transfer', 0], ['ownership_transfer', 1],
            ['delete', -1], ['delete', 0], ['delete', 1],
        ];
    }

    #[DataProvider('operations')]
    public function test_mutations_reuse_their_locked_account_and_exact_session(string $operation): void
    {
        $fixture = $this->fixture($operation);
        $locks = ['users' => 0, 'sessions' => 0];
        DB::listen(static function (QueryExecuted $event) use (&$locks): void {
            foreach (array_keys($locks) as $table) {
                if (str_starts_with($event->sql, 'select * from "'.$table.'"') && str_contains($event->sql, 'for update')) {
                    $locks[$table]++;
                }
            }
        });
        $this->mutate($operation, $fixture)->assertStatus($this->successStatus($operation));
        $this->assertSame(['users' => 1, 'sessions' => 1], $locks);
    }

    #[DataProvider('invitationDecisions')]
    public function test_stale_identity_keeps_the_parked_invitation_for_a_new_session(string $operation, string $decision): void
    {
        $fixture = $this->fixture($operation);
        $cookieName = PendingHandoff::cookieName(PendingHandoff::INVITATION);
        $parked = $this->postJson('/api/v1/pending/invitation', ['token' => $fixture['bearer']])->assertCreated();
        $cookies = array_values(array_filter($parked->headers->getCookies(), static fn ($cookie): bool => $cookie->getName() === $cookieName));
        $this->assertCount(1, $cookies);
        $this->withCookie($cookieName, $cookies[0]->getValue());
        $eventsBefore = DB::table('audit_events')->count();
        $armed = true;
        $intercepted = false;
        DB::listen(static function (QueryExecuted $event) use (&$armed, &$intercepted, $fixture): void {
            if ($armed && $event->connection->transactionLevel() === 0 && str_starts_with($event->sql, 'select') && str_contains($event->sql, 'from "invitations"')) {
                $armed = false;
                $intercepted = true;
                DB::table('users')->where('id', $fixture['actor']->id)->update(['security_version' => 2]);
            }
        });
        try {
            $failed = $this->postJson('/api/v1/workspaces/invitations/'.$decision, [])->assertStatus(409);
        } finally {
            $armed = false;
        }
        $this->assertTrue($intercepted);
        $this->assertSame([], array_values(array_filter($failed->headers->getCookies(), static fn ($cookie): bool => $cookie->getName() === $cookieName)));
        $this->assertDatabaseHas('invitations', ['id' => $fixture['invitation']->id, 'status' => 'pending']);
        $this->assertSame($eventsBefore, DB::table('audit_events')->count());
        $this->assertSame(0, DB::table('audit_events')->where('action', 'workspace.'.$operation)->count());
        $this->withCookie('uvh_session', SessionManager::create($fixture['actor']->id, Request::create('/'), 2));
        $this->getJson('/api/v1/pending')->assertOk()->assertJsonPath('invitation.pending', true);
        $this->postJson('/api/v1/workspaces/invitations/'.$decision, [])->assertOk();
        $this->assertSame(1, DB::table('audit_events')->where('action', 'workspace.'.$operation)->count());
    }

    #[DataProvider('sessionBoundaries')]
    public function test_expiry_after_middleware_is_revalidated_before_spending_credentials(string $operation, int $seconds): void
    {
        $fixture = $this->fixture($operation);
        $before = $this->businessState();
        $armed = true;
        DB::listen(static function (QueryExecuted $event) use (&$armed, $fixture, $seconds): void {
            if ($armed && str_contains($event->sql, '"users"') && str_contains($event->sql, 'for update')) {
                $armed = false;
                // Middleware already admitted the original session. Make its
                // locked representation reach the deadline at the mutation.
                DB::table('sessions')->where('user_id', $fixture['actor']->id)->update(['expires_at' => now()->addSeconds($seconds)]);
            }
        });
        try {
            $response = $this->mutate($operation, $fixture);
        } finally {
            $armed = false;
        }
        if ($seconds > 0) {
            $response->assertOk();
            $this->assertSame([], $fixture['owner']->fresh()->recovery_codes);
            $this->assertSame(1, DB::table('audit_events')->where('action', 'workspace.'.$operation)->count());
        } else {
            $response->assertStatus(409);
            $this->assertSame($before, $this->businessState());
            $this->assertDatabaseCount('audit_outbox', 0);
            $this->assertDatabaseCount('audit_events', 0);
            Queue::assertNothingPushed();
        }
    }

    #[DataProvider('invitationDecisions')]
    public function test_failed_admission_preserves_the_parked_invitation_for_retry(string $operation, string $decision): void
    {
        $fixture = $this->fixture($operation);
        $cookieName = PendingHandoff::cookieName(PendingHandoff::INVITATION);
        $parked = $this->postJson('/api/v1/pending/invitation', ['token' => $fixture['bearer']])->assertCreated();
        $cookies = array_values(array_filter($parked->headers->getCookies(), static fn ($cookie): bool => $cookie->getName() === $cookieName));
        $this->assertCount(1, $cookies);
        $this->withCookie($cookieName, $cookies[0]->getValue());
        Schema::rename('audit_outbox', 'audit_outbox_unavailable');
        try {
            $failed = $this->postJson('/api/v1/workspaces/invitations/'.$decision, [])->assertServerError();
            $this->assertSame([], array_values(array_filter($failed->headers->getCookies(), static fn ($cookie): bool => $cookie->getName() === $cookieName)));
        } finally {
            Schema::rename('audit_outbox_unavailable', 'audit_outbox');
        }
        $this->assertDatabaseHas('invitations', ['id' => $fixture['invitation']->id, 'status' => 'pending']);
        $retry = $this->postJson('/api/v1/workspaces/invitations/'.$decision, [])->assertOk();
        $cleared = array_values(array_filter($retry->headers->getCookies(), static fn ($cookie): bool => $cookie->getName() === $cookieName));
        $this->assertCount(1, $cleared);
        $this->assertLessThan(time(), $cleared[0]->getExpiresTime());
        $this->assertSame(1, DB::table('audit_events')->where('action', 'workspace.'.$operation)->count());
    }

    #[DataProvider('operations')]
    public function test_rejected_operations_do_not_publish_a_success_event(string $operation): void
    {
        $fixture = $this->fixture($operation);
        $path = '/api/v1/workspaces/'.$fixture['workspace']->id;
        if (in_array($operation, ['invitation_cancelled', 'invitation_resent'], true)) {
            $fixture['invitation']->update(['status' => 'accepted']);
        }
        if ($operation === 'leave') {
            $this->withCookie('uvh_session', SessionManager::create($fixture['owner']->id, Request::create('/'), 1, true));
        }
        $before = $this->businessState();
        $response = match ($operation) {
            'create' => $this->postJson('/api/v1/workspaces', ['name' => '']),
            'rename' => $this->patchJson($path, ['name' => '']),
            'role_change' => $this->patchJson($path.'/members/'.$fixture['target']->id, ['role' => 'owner']),
            'ownership_transfer' => $this->postJson($path.'/transfer-ownership', ['password' => 'wrong', 'factorCode' => self::RECOVERY, 'targetUserId' => $fixture['target']->id]),
            'member_remove' => $this->deleteJson($path.'/members/'.$fixture['owner']->id),
            'leave' => $this->postJson($path.'/leave'),
            'delete' => $this->deleteJson($path, ['password' => 'wrong', 'factorCode' => self::RECOVERY, 'confirmation' => $fixture['workspace']->name]),
            'invite' => $this->postJson($path.'/invitations', ['email' => 'invalid', 'role' => 'viewer']),
            'invitation_accepted' => $this->postJson('/api/v1/workspaces/invitations/accept', ['token' => 'wrong']),
            'invitation_rejected' => $this->postJson('/api/v1/workspaces/invitations/reject', ['token' => 'wrong']),
            'invitation_cancelled', 'invitation_resent' => $this->mutate($operation, $fixture),
        };
        $response->assertStatus(match ($operation) {
            'create', 'rename', 'invite' => 422,
            'invitation_accepted', 'invitation_rejected' => 400,
            'invitation_cancelled' => 409,
            'invitation_resent' => 404,
            default => 403,
        });
        $this->assertSame($before, $this->businessState());
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('audit_events', 0);
        Queue::assertNothingPushed();
    }

    private function fixture(string $operation): array
    {
        $owner = User::factory()->create([
            'email' => 'owner@example.test', 'email_verified_at' => now(), 'password_hash' => Hash::make(self::PASSWORD),
            'mfa_enabled' => true, 'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP'),
            'recovery_codes' => [Ids::sha256Hex(self::RECOVERY)],
        ]);
        $target = User::factory()->create(['email' => 'member@example.test', 'email_verified_at' => now()]);
        $recipient = User::factory()->create(['email' => 'recipient@example.test', 'email_verified_at' => now()]);
        $workspace = Workspace::forceCreate(['name' => 'Audit Workspace', 'slug' => 'audit-workspace', 'owner_user_id' => $owner->id]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $workspace->memberships()->create(['user_id' => $target->id, 'role' => 'admin']);
        $workspace->quota()->create(['links_limit' => 1000]);
        Webhook::create([
            'workspace_id' => $workspace->id, 'created_by' => $target->id, 'url' => 'https://hooks.example.test/audit',
            'secret' => UvhCrypto::encryptAtRest('fixture-hook-secret'), 'events' => ['link.created'], 'active' => true, 'config_version' => 1,
        ]);
        DB::table('api_tokens')->insert([
            'workspace_id' => $workspace->id, 'created_by' => $target->id, 'name' => 'Member token',
            'token_hash' => Ids::sha256Hex('fixture-token'), 'scopes' => '["links:read"]', 'created_at' => now(),
        ]);
        $bearer = Ids::randomToken(32);
        $invitation = Invitation::create([
            'workspace_id' => $workspace->id, 'invited_by' => $owner->id, 'email' => $recipient->email,
            'role' => 'viewer', 'status' => 'pending', 'token' => Ids::sha256Hex($bearer), 'expires_at' => now()->addDay(),
        ]);
        Invitation::create([
            'workspace_id' => $workspace->id, 'invited_by' => $target->id, 'email' => 'other@example.test',
            'role' => 'viewer', 'status' => 'pending', 'token' => Ids::sha256Hex('other-fixture-bearer'), 'expires_at' => now()->addDay(),
        ]);
        $actor = match ($operation) {
            'leave' => $target,
            'invitation_accepted', 'invitation_rejected' => $recipient,
            default => $owner,
        };
        $session = SessionManager::create($actor->id, Request::create('/'), (int) $actor->security_version, true);
        DB::table('sessions')->where('id', Ids::sha256Hex($session))->update(['mfa_verified_at' => now()->subMinute()]);
        $this->withCookie('uvh_session', $session);

        return compact('owner', 'target', 'recipient', 'actor', 'workspace', 'invitation', 'bearer');
    }

    private function mutate(string $operation, array $fixture): TestResponse
    {
        $path = '/api/v1/workspaces/'.$fixture['workspace']->id;
        $credentials = ['password' => self::PASSWORD, 'factorCode' => self::RECOVERY];

        return match ($operation) {
            'create' => $this->postJson('/api/v1/workspaces', ['name' => 'Created workspace']),
            'rename' => $this->patchJson($path, ['name' => 'Renamed workspace']),
            'role_change' => $this->patchJson($path.'/members/'.$fixture['target']->id, ['role' => 'viewer']),
            'ownership_transfer' => $this->postJson($path.'/transfer-ownership', [...$credentials, 'targetUserId' => $fixture['target']->id]),
            'member_remove' => $this->deleteJson($path.'/members/'.$fixture['target']->id),
            'leave' => $this->postJson($path.'/leave'),
            'delete' => $this->deleteJson($path, [...$credentials, 'confirmation' => $fixture['workspace']->name]),
            'invite' => $this->postJson($path.'/invitations', ['email' => 'new-recipient@example.test', 'role' => 'viewer']),
            'invitation_accepted' => $this->postJson('/api/v1/workspaces/invitations/accept', ['token' => $fixture['bearer']]),
            'invitation_rejected' => $this->postJson('/api/v1/workspaces/invitations/reject', ['token' => $fixture['bearer']]),
            'invitation_cancelled' => $this->deleteJson($path.'/invitations/'.$fixture['invitation']->id),
            'invitation_resent' => $this->postJson($path.'/invitations/'.$fixture['invitation']->id.'/resend'),
        };
    }

    private function successStatus(string $operation): int
    {
        return in_array($operation, ['create', 'invite'], true) ? 201 : 200;
    }

    private function businessState(): array
    {
        $state = [];
        foreach (['users', 'workspaces', 'memberships', 'quotas', 'api_tokens', 'webhooks', 'invitations', 'notifications', 'mail_outbox', 'invitation_mail_budgets'] as $table) {
            $state[$table] = DB::table($table)->get()->map(static fn (object $row): string => json_encode($row, JSON_THROW_ON_ERROR))->sort()->values()->all();
        }
        $state['mfa_proofs'] = DB::table('sessions')->orderBy('id')->pluck('mfa_verified_at', 'id')->all();

        return $state;
    }
}
