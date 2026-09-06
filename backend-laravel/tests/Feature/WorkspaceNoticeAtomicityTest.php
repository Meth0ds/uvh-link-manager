<?php

namespace Tests\Feature;

use App\Jobs\DeliverMailOutboxJob;
use App\Models\AccountDeletionRequest;
use App\Models\User;
use App\Models\Webhook;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\MailDeliveryEligibility;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Prepared only: the parent rejects non-*_test DBs before fixture truncation. */
final class WorkspaceNoticeAtomicityTest extends TestCase
{
    private const PASSWORD = 'tiovivo-cobrizo-astilla-42';

    private const RECOVERY = 'ABCD2345EFGH6789';

    private int $failAtInsert = 0;

    private bool $poisonTransaction = false;

    private array $insertLevels = [];

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, email_tokens, mail_outbox, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        config(['cache.default' => 'array']);
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'workspace-notice-csrf')->withHeaders(['X-CSRF-Token' => 'workspace-notice-csrf']);
        Queue::fake();
        DB::listen(function (QueryExecuted $event): void {
            if (! str_starts_with(strtolower($event->sql), 'insert') || ! str_contains($event->sql, '"mail_outbox"')) {
                return;
            }
            $this->insertLevels[] = $event->connection->transactionLevel();
            if ($this->failAtInsert === count($this->insertLevels)) {
                if ($this->poisonTransaction) {
                    // Exercise PostgreSQL's aborted-transaction state as well
                    // as PHP exceptions: cancellation needs a real savepoint.
                    $event->connection->select('SELECT 1 / 0');
                }
                throw new \RuntimeException('Fixture: workspace notice interrupted after INSERT');
            }
        });
    }

    public static function operations(): array
    {
        return ['API token' => ['token'], 'ownership transfer' => ['transfer'], 'workspace deletion' => ['delete']];
    }

    #[DataProvider('operations')]
    public function test_admission_failure_rolls_back_the_resource_and_recovery_code(string $operation): void
    {
        [$owner, $target, $workspace, $hook] = $this->workspaceFixture();
        $tokenId = DB::table('api_tokens')->insertGetId([
            'workspace_id' => $workspace->id, 'created_by' => $owner->id, 'name' => 'Existing token',
            'token_hash' => Ids::sha256Hex('existing-fixture-token'), 'scopes' => '["links:read"]', 'created_at' => now(),
        ]);
        $credentials = ['password' => self::PASSWORD, 'factorCode' => self::RECOVERY];
        [$method, $url, $payload, $mailCount] = match ($operation) {
            'token' => ['POST', '/api/v1/tokens', [...$credentials, 'name' => 'New token', 'scopes' => ['links:read']], 1],
            'transfer' => ['POST', '/api/v1/workspaces/'.$workspace->id.'/transfer-ownership', [...$credentials, 'targetUserId' => (int) $target->id], 2],
            'delete' => ['DELETE', '/api/v1/workspaces/'.$workspace->id, [...$credentials, 'confirmation' => $workspace->name], 1],
        };
        $this->failAtInsert = $mailCount;
        $this->json($method, $url, $payload)->assertStatus(503)->assertJsonMissingPath('plainToken');
        $this->assertSame(array_fill(0, $mailCount, 1), $this->insertLevels);
        $this->assertSame([Ids::sha256Hex(self::RECOVERY)], $owner->refresh()->recovery_codes);
        $this->assertDatabaseHas('workspaces', ['id' => $workspace->id, 'owner_user_id' => $owner->id]);
        $this->assertDatabaseHas('memberships', ['workspace_id' => $workspace->id, 'user_id' => $owner->id, 'role' => 'owner']);
        $this->assertDatabaseHas('memberships', ['workspace_id' => $workspace->id, 'user_id' => $target->id, 'role' => 'viewer']);
        $this->assertDatabaseHas('webhooks', ['id' => $hook->id, 'active' => true, 'config_version' => 1]);
        $this->assertDatabaseHas('api_tokens', ['id' => $tokenId, 'revoked_at' => null]);
        $this->assertDatabaseCount('api_tokens', 1);
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();

        $this->failAtInsert = 0;
        $response = $this->json($method, $url, $payload)->assertStatus($operation === 'token' ? 201 : 200);
        $this->assertSame([], $owner->refresh()->recovery_codes);
        if ($operation === 'token') {
            $this->assertDatabaseHas('api_tokens', ['id' => $response->json('token.id'), 'token_hash' => Ids::sha256Hex($response->json('plainToken'))]);
            $this->assertNotices([['api_token_created', $owner->email]], $response->json('plainToken'));
        } elseif ($operation === 'transfer') {
            $this->assertDatabaseHas('workspaces', ['id' => $workspace->id, 'owner_user_id' => $target->id]);
            $this->assertDatabaseHas('memberships', ['workspace_id' => $workspace->id, 'user_id' => $owner->id, 'role' => 'admin']);
            $this->assertDatabaseHas('memberships', ['workspace_id' => $workspace->id, 'user_id' => $target->id, 'role' => 'owner']);
            $this->assertSame(1, DB::table('memberships')->where('workspace_id', $workspace->id)->where('role', 'owner')->count());
            $this->assertNotices([['workspace_ownership_transfer', $owner->email], ['workspace_ownership_transfer', $target->email]]);
        } else {
            $this->assertDatabaseMissing('workspaces', ['id' => $workspace->id]);
            $this->assertDatabaseMissing('webhooks', ['id' => $hook->id]);
            $this->assertDatabaseMissing('api_tokens', ['id' => $tokenId]);
            // Historical notices must survive deletion of their workspace.
            $this->assertNotices([['workspace_deleted', $owner->email]]);
        }
        Queue::assertPushed(DeliverMailOutboxJob::class, $mailCount);
    }

    public function test_busy_webhook_does_not_spend_a_recovery_code_or_leave_partial_deactivation(): void
    {
        [$owner, , $workspace, $firstHook] = $this->workspaceFixture();
        $secondHook = $this->hook($workspace, $owner);
        $lock = Cache::lock('uvh:webhook-config:'.$secondHook->id, 60);
        $this->assertTrue($lock->get());
        $payload = ['confirmation' => $workspace->name, 'password' => self::PASSWORD, 'factorCode' => self::RECOVERY];
        try {
            $this->deleteJson('/api/v1/workspaces/'.$workspace->id, $payload)->assertConflict();
            $this->assertSame([Ids::sha256Hex(self::RECOVERY)], $owner->refresh()->recovery_codes);
            foreach ([$firstHook, $secondHook] as $hook) {
                $this->assertDatabaseHas('webhooks', ['id' => $hook->id, 'active' => true, 'config_version' => 1]);
            }
            $this->assertDatabaseHas('workspaces', ['id' => $workspace->id]);
            $this->assertDatabaseCount('mail_outbox', 0);
            Queue::assertNothingPushed();
        } finally {
            $lock->release();
        }
        $this->deleteJson('/api/v1/workspaces/'.$workspace->id, $payload)->assertOk();
        $this->assertSame([], $owner->refresh()->recovery_codes);
    }

    public static function cancellationFailures(): array
    {
        return ['mail accepted' => ['none'], 'PHP admission failure' => ['exception'], 'PostgreSQL admission failure' => ['sql']];
    }

    #[DataProvider('cancellationFailures')]
    public function test_protective_cancellation_commits_even_when_its_notice_fails(string $failure): void
    {
        $user = User::factory()->create(['deleted_at' => now(), 'security_version' => 2]);
        $plain = Ids::randomToken(32);
        $deletion = AccountDeletionRequest::create([
            'user_id' => $user->id, 'security_version' => 2, 'status' => 'scheduled',
            'cancel_token_hash' => Ids::sha256Hex($plain), 'execute_after' => now()->addDay(), 'confirmed_at' => now(),
        ]);
        $this->failAtInsert = $failure === 'none' ? 0 : 1;
        $this->poisonTransaction = $failure === 'sql';
        $this->postJson('/api/v1/auth/account-deletion/cancel', ['token' => $plain])->assertOk();
        $this->assertSame([2], $this->insertLevels);
        $this->assertNull($user->refresh()->deleted_at);
        $this->assertSame(3, $user->security_version);
        $this->assertSame('cancelled', $deletion->refresh()->status);
        $this->assertNull($deletion->cancel_token_hash);
        if ($failure === 'none') {
            $this->assertNotices([['account_deletion_cancelled', $user->email]]);
            Queue::assertPushed(DeliverMailOutboxJob::class, 1);
        } else {
            $this->assertDatabaseCount('mail_outbox', 0);
            Queue::assertNothingPushed();
        }
        $this->postJson('/api/v1/auth/account-deletion/cancel', ['token' => $plain])->assertStatus(400);
    }

    private function workspaceFixture(): array
    {
        $owner = User::factory()->create([
            'email' => 'owner@example.test', 'password_hash' => Hash::make(self::PASSWORD), 'mfa_enabled' => true,
            'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP'), 'recovery_codes' => [Ids::sha256Hex(self::RECOVERY)],
        ]);
        $target = User::factory()->create(['email' => 'member@example.test']);
        $workspace = Workspace::create(['name' => 'Notice Workspace', 'slug' => 'notice-workspace', 'owner_user_id' => $owner->id]);
        foreach ([[$owner->id, 'owner'], [$target->id, 'viewer']] as [$userId, $role]) {
            DB::table('memberships')->insert(['workspace_id' => $workspace->id, 'user_id' => $userId, 'role' => $role, 'created_at' => now()]);
        }
        $session = SessionManager::create($owner->id, Request::create('/'), 1, true);
        $this->withCookie('uvh_session', $session)->withHeader('X-Workspace-Id', (string) $workspace->id);

        return [$owner, $target, $workspace, $this->hook($workspace, $owner)];
    }

    private function hook(Workspace $workspace, User $owner): Webhook
    {
        return Webhook::create([
            'workspace_id' => $workspace->id, 'created_by' => $owner->id, 'url' => 'https://example.test/webhook',
            'secret' => UvhCrypto::encryptAtRest('fixture-hook-secret'), 'events' => ['link.created'], 'active' => true, 'config_version' => 1,
        ]);
    }

    private function assertNotices(array $expected, ?string $plainToken = null): void
    {
        $rows = DB::table('mail_outbox')->orderBy('id')->get();
        $this->assertCount(count($expected), $rows);
        foreach ($rows as $index => $row) {
            $this->assertTrue(MailDeliveryEligibility::isCurrent($row));
            $json = UvhCrypto::decryptAtRest($row->encrypted_envelope);
            $envelope = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
            $this->assertSame($expected[$index], [$row->kind, $envelope['to']]);
            if ($plainToken !== null) {
                $this->assertStringNotContainsString($plainToken, $json);
            }
        }
    }
}
