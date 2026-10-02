<?php

namespace Tests\Feature;

use App\Models\AccountDeletionRequest;
use App\Models\AccountRecoveryRequest;
use App\Models\DataExportRequest;
use App\Models\EmailChangeRequest;
use App\Models\EmailToken;
use App\Models\User;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class SecurityIncidentBoundaryTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'incident-fixture')->withHeader('X-CSRF-Token', 'incident-fixture');
        $this->travelTo(now()->startOfSecond());
    }

    public static function deadlines(): array
    {
        return ['live' => [1, 200], 'boundary' => [0, 400], 'expired' => [-1, 400]];
    }

    #[DataProvider('deadlines')]
    public function test_deadline_is_exclusive_and_rejection_preserves_access(int $seconds, int $status): void
    {
        $user = User::factory()->create();
        $session = SessionManager::create($user->id, Request::create('/'), 1);
        $token = $this->token($user, $seconds);
        $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $token])->assertStatus($status);
        $this->assertSame($status === 200 ? 2 : 1, (int) $user->refresh()->security_version);
        $this->assertSame($status === 200, DB::table('sessions')->where('id', Ids::sha256Hex($session))->value('revoked_at') !== null);
        $this->assertSame($status === 200, EmailToken::findOrFail(Ids::sha256Hex($token))->used_at !== null);
        $this->assertSame($status === 200 ? 1 : 0, DB::table('audit_events')->where('action', 'auth.emergency_access_revoked')->count());
    }

    public static function browserAccounts(): array
    {
        return ['owner' => ['owner', true], 'different account' => ['foreign', false], 'anonymous' => ['anonymous', false]];
    }

    #[DataProvider('browserAccounts')]
    public function test_only_the_affected_browser_identity_is_signed_out(string $identity, bool $current): void
    {
        $owner = User::factory()->create();
        $foreign = User::factory()->create();
        $ownerSession = SessionManager::create($owner->id, Request::create('/'), 1);
        $foreignSession = SessionManager::create($foreign->id, Request::create('/'), 1);
        if ($identity !== 'anonymous') {
            $this->withCookie('uvh_session', $identity === 'owner' ? $ownerSession : $foreignSession);
        }
        $token = $this->token($owner);
        $response = $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $token])->assertOk();
        $sessionCookies = collect($response->headers->getCookies())->filter(fn ($cookie) => $cookie->getName() === 'uvh_session');
        $this->assertCount($current ? 1 : 0, $sessionCookies);
        $response->assertJsonPath('current', $current);
        $this->assertDatabaseHas('sessions', ['id' => Ids::sha256Hex($foreignSession), 'revoked_at' => null]);
        $this->assertNotNull(DB::table('sessions')->where('id', Ids::sha256Hex($ownerSession))->value('revoked_at'));
        $this->assertSame(1, (int) $foreign->refresh()->security_version);
        if ($identity === 'foreign') {
            $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('user.id', $foreign->id);
        }
        $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $token])->assertStatus(400);
        $this->assertSame(2, (int) $owner->refresh()->security_version);
    }

    public static function unavailableAudit(): array
    {
        return ['admission' => ['audit_outbox'], 'history' => ['audit_events']];
    }

    #[DataProvider('unavailableAudit')]
    public function test_audit_failure_never_restores_compromised_access(string $table): void
    {
        $user = User::factory()->create(['mfa_enabled' => true, 'mfa_secret' => 'encrypted-fixture', 'recovery_codes' => ['opaque-fixture']]);
        $before = $user->refresh()->only(['email', 'password_hash', 'mfa_enabled', 'mfa_secret', 'recovery_codes']);
        $session = SessionManager::create($user->id, Request::create('/'), 1, true);
        $token = $this->token($user);
        Schema::rename($table, $table.'_unavailable');
        try {
            $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $token])->assertOk();
            $this->assertSame($before, $user->refresh()->only(array_keys($before)));
            $this->assertSame(2, (int) $user->security_version);
            $this->assertNotNull(DB::table('sessions')->where('id', Ids::sha256Hex($session))->value('revoked_at'));
            $this->assertNotNull(EmailToken::findOrFail(Ids::sha256Hex($token))->used_at);
            if ($table === 'audit_events') {
                $this->assertDatabaseCount('audit_outbox', 1);
            }
        } finally {
            Schema::rename($table.'_unavailable', $table);
        }
        if ($table === 'audit_events') {
            $this->assertTrue(Audit::drain());
            $this->assertTrue(Audit::drain());
            $this->assertSame(1, DB::table('audit_events')->where('action', 'auth.emergency_access_revoked')->count());
        }
    }

    private function token(User $user, int $seconds = 60): string
    {
        $token = Ids::randomToken(32);
        EmailToken::create(['id' => Ids::sha256Hex($token), 'user_id' => $user->id, 'kind' => 'security_revoke', 'expires_at' => now()->addSeconds($seconds)]);

        return $token;
    }

    public function test_consuming_an_incident_cancels_owner_bearers_and_pending_operations_only(): void
    {
        Storage::fake('local');
        $user = User::factory()->create(['mfa_enabled' => true, 'mfa_secret' => 'encrypted-fixture', 'recovery_codes' => ['opaque-fixture'], 'mfa_pending_secret' => 'pending-fixture', 'mfa_pending_expires_at' => now()->addMinutes(5)]);
        $foreign = User::factory()->create();
        $identity = $user->refresh()->only(['email', 'password_hash', 'mfa_enabled', 'mfa_secret', 'recovery_codes']);
        $token = $this->token($user);
        $second = $this->token($user);
        $foreignToken = $this->token($foreign);
        $reset = Ids::randomToken(32);
        EmailToken::create(['id' => Ids::sha256Hex($reset), 'user_id' => $user->id, 'kind' => 'reset', 'expires_at' => now()->addHour()]);
        EmailChangeRequest::create(['id' => Ids::sha256Hex(Ids::randomToken(32)), 'user_id' => $user->id, 'new_email' => 'next@example.test', 'security_version' => 1, 'expires_at' => now()->addHour()]);
        $recovery = AccountRecoveryRequest::create(['user_id' => $user->id, 'security_version' => 1, 'status' => 'requested', 'confirmation_token_hash' => Ids::sha256Hex(Ids::randomToken(32)), 'confirmation_expires_at' => now()->addHour(), 'expires_at' => now()->addDay()]);
        $deletion = AccountDeletionRequest::create(['user_id' => $user->id, 'security_version' => 1, 'status' => 'requested', 'confirmation_token_hash' => Ids::sha256Hex(Ids::randomToken(32)), 'confirmation_expires_at' => now()->addHour()]);
        $path = 'account-exports/'.str_repeat('a', 32).'.uvh';
        Storage::disk('local')->put($path, 'encrypted-fixture');
        $export = DataExportRequest::create(['user_id' => $user->id, 'security_version' => 1, 'status' => 'ready', 'artifact_path' => $path, 'mail_generation_hash' => Ids::sha256Hex('fixture')]);
        $foreignExport = DataExportRequest::create(['user_id' => $foreign->id, 'security_version' => 1, 'status' => 'processing']);
        $workspace = DB::table('workspaces')->insertGetId(['name' => 'Fixture', 'slug' => 'incident-fixture', 'owner_user_id' => $user->id, 'created_at' => now(), 'updated_at' => now()]);
        $apiToken = DB::table('api_tokens')->insertGetId(['workspace_id' => $workspace, 'name' => 'Fixture', 'created_by' => $user->id, 'token_hash' => Ids::sha256Hex('incident-api-fixture'), 'scopes' => '[]', 'created_at' => now()]);
        $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $token])->assertOk();
        $this->assertSame($identity, $user->refresh()->only(array_keys($identity)));
        $this->assertNull($user->mfa_pending_secret);
        $this->assertNull($user->mfa_pending_expires_at);
        $this->assertNotNull(EmailToken::findOrFail(Ids::sha256Hex($second))->used_at);
        $this->assertNull(EmailToken::findOrFail(Ids::sha256Hex($foreignToken))->used_at);
        $this->assertDatabaseMissing('email_tokens', ['id' => Ids::sha256Hex($reset)]);
        $this->assertDatabaseMissing('email_change_requests', ['user_id' => $user->id]);
        $this->assertSame('cancelled', $recovery->refresh()->status);
        $this->assertNull($recovery->confirmation_token_hash);
        $this->assertSame('cancelled', $deletion->refresh()->status);
        $this->assertNull($deletion->confirmation_token_hash);
        $this->assertSame('cancelled', $export->refresh()->status);
        $this->assertNull($export->artifact_path);
        $this->assertNull($export->mail_generation_hash);
        Storage::disk('local')->assertMissing($path);
        $this->assertSame('processing', $foreignExport->refresh()->status);
        $this->assertNotNull(DB::table('api_tokens')->where('id', $apiToken)->value('revoked_at'));
        $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $second])->assertStatus(400);
    }

    public static function blockedAccounts(): array
    {
        return ['administrative block' => [null, false], 'executed deletion' => ['executed', false], 'scheduled deletion' => ['scheduled', true]];
    }

    #[DataProvider('blockedAccounts')]
    public function test_only_a_pending_deletion_can_be_stopped_without_authenticating(?string $status, bool $restore): void
    {
        $user = User::factory()->create(['deleted_at' => now()]);
        $token = $this->token($user);
        $deletion = $status ? AccountDeletionRequest::create(['user_id' => $user->id, 'security_version' => 1, 'status' => $status, 'execute_after' => now()->addDays(7)]) : null;
        $response = $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $token])->assertOk()->assertJsonPath('current', false);
        $this->assertCount(0, collect($response->headers->getCookies())->filter(fn ($cookie) => $cookie->getName() === 'uvh_session'));
        $this->assertSame($restore, $user->refresh()->deleted_at === null);
        $this->assertSame($restore ? 2 : 1, (int) $user->security_version);
        if ($deletion) {
            $this->assertSame($restore ? 'cancelled' : $status, $deletion->refresh()->status);
        }
        $this->getJson('/api/v1/auth/me')->assertUnauthorized();
    }

    public static function invalidBearers(): array
    {
        return ['malformed' => ['preview-only'], 'wrong kind' => ['reset']];
    }

    #[DataProvider('invalidBearers')]
    public function test_invalid_bearers_cannot_change_security_state(string $kind): void
    {
        $user = User::factory()->create();
        $token = Ids::randomToken(32);
        EmailToken::create(['id' => Ids::sha256Hex($token), 'user_id' => $user->id, 'kind' => 'reset', 'expires_at' => now()->addHour()]);
        $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $kind === 'reset' ? $token : $kind])->assertStatus(400);
        $this->assertSame(1, (int) $user->refresh()->security_version);
        $this->assertNull(EmailToken::findOrFail(Ids::sha256Hex($token))->used_at);
        $this->assertDatabaseCount('audit_events', 0);
    }

    public function test_business_database_failure_rolls_back_and_keeps_the_incident_retryable(): void
    {
        $user = User::factory()->create();
        $session = SessionManager::create($user->id, Request::create('/'), 1);
        $token = $this->token($user);
        $fail = true;
        DB::listen(static function (QueryExecuted $query) use (&$fail): void {
            if ($fail && str_starts_with(strtolower($query->sql), 'update "sessions"')) {
                throw new \RuntimeException('Fixture: session revocation unavailable');
            }
        });
        $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $token])->assertServerError();
        $this->assertSame(1, (int) $user->refresh()->security_version);
        $this->assertDatabaseHas('sessions', ['id' => Ids::sha256Hex($session), 'revoked_at' => null]);
        $this->assertNull(EmailToken::findOrFail(Ids::sha256Hex($token))->used_at);
        $fail = false;
        $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $token])->assertOk();
        $this->assertSame(2, (int) $user->refresh()->security_version);
    }
}
