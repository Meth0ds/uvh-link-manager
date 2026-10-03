<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\User;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class ExpectedAccountBoundaryTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        Queue::fake();
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'expected-account')->withHeader('X-CSRF-Token', 'expected-account');
    }

    private function account(): array
    {
        $user = User::factory()->create();
        $token = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version);

        return [$user, $token, Ids::sha256Hex($token)];
    }

    public static function protectedRequests(): array
    {
        return [
            'identity' => ['GET', '/api/v1/auth/me', []],
            'profile' => ['PATCH', '/api/v1/auth/profile', ['name' => 'Wrong account write']],
            'inbox' => ['GET', '/api/v1/notifications', []],
            'mark inbox read' => ['POST', '/api/v1/notifications/read-all', []],
            'preferences' => ['PATCH', '/api/v1/notifications/preferences', ['preferences' => []]],
            'logout' => ['POST', '/api/v1/auth/logout', []],
            'workspaces' => ['GET', '/api/v1/workspaces', []],
            'tenant read' => ['GET', '/api/v1/links', []],
            'tenant write' => ['POST', '/api/v1/collections', ['name' => 'Wrong account collection']],
            'private artifact' => ['POST', '/api/v1/auth/data-export/download', ['password' => 'fixture']],
            'admin' => ['GET', '/api/v1/admin/overview', []],
        ];
    }

    #[DataProvider('protectedRequests')]
    public function test_expected_account_mismatch_stops_before_business_effects(string $method, string $path, array $body): void
    {
        [$actual, $token, $sessionId] = $this->account();
        [$expected] = $this->account();
        $notificationId = DB::table('notifications')->insertGetId([
            'user_id' => $actual->id, 'kind' => 'auth.new_login', 'subject' => 'Fixture',
        ]);
        $before = $actual->refresh()->getAttributes();
        $sessions = DB::table('sessions')->orderBy('id')->get()->toJson();
        $response = $this->withCookie(config('uvh.session_cookie'), $token)
            ->withHeader('X-Uvh-Account-Id', (string) $expected->id)->json($method, $path, $body);
        $response->assertStatus(409)->assertExactJson([
            'error' => 'La sesión cambió. Vuelve a comprobar tu cuenta antes de continuar.',
            'reason' => 'session_context_changed',
        ])->assertCookieMissing(config('uvh.session_cookie'));
        $this->assertSame($before, $actual->fresh()->getAttributes());
        $this->assertSame($sessions, DB::table('sessions')->orderBy('id')->get()->toJson());
        $this->assertNull(DB::table('sessions')->where('id', $sessionId)->value('revoked_at'));
        $this->assertNull(DB::table('notifications')->where('id', $notificationId)->value('read_at'));
        $this->assertDatabaseCount('audit_events', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('notification_preferences', 0);
        Queue::assertNothingPushed();
    }

    public static function invalidExpectedIds(): array
    {
        return ['empty' => [''], 'zero' => ['0'], 'negative' => ['-1'], 'leading zero' => ['01'],
            'fraction' => ['1.0'], 'multiple values' => ['1,2'], 'oversize' => [str_repeat('9', 30)]];
    }

    #[DataProvider('invalidExpectedIds')]
    public function test_malformed_expectation_does_not_become_authority(string $expected): void
    {
        [$actual, $token] = $this->account();
        $before = $actual->name;
        $this->withCookie(config('uvh.session_cookie'), $token)->withHeader('X-Uvh-Account-Id', $expected)
            ->patchJson('/api/v1/auth/profile', ['name' => 'Must not be saved'])
            ->assertStatus(400)->assertJsonPath('reason', 'invalid_account_context');
        $this->assertSame($before, $actual->fresh()->name);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('audit_events', 0);
    }

    public function test_matching_expectation_keeps_profile_and_session_contract(): void
    {
        [$user, $token, $id] = $this->account();
        $this->withCookie(config('uvh.session_cookie'), $token)->withHeader('X-Uvh-Account-Id', (string) $user->id)
            ->patchJson('/api/v1/auth/profile', ['name' => 'Confirmed'])->assertOk()->assertJsonPath('user.name', 'Confirmed');
        $this->assertSame('Confirmed', $user->fresh()->name);
        $this->assertNull(DB::table('sessions')->where('id', $id)->value('revoked_at'));
    }

    public function test_legacy_client_without_expectation_remains_authenticated(): void
    {
        [$user, $token] = $this->account();
        $this->withCookie(config('uvh.session_cookie'), $token)->getJson('/api/v1/auth/me')
            ->assertOk()->assertJsonPath('user.id', $user->id);
    }

    public function test_header_alone_never_authenticates(): void
    {
        [$user] = $this->account();
        $this->withHeader('X-Uvh-Account-Id', (string) $user->id)->getJson('/api/v1/auth/me')->assertUnauthorized();
    }

    public function test_matching_header_does_not_grant_admin(): void
    {
        [$user, $token] = $this->account();
        $this->withCookie(config('uvh.session_cookie'), $token)->withHeader('X-Uvh-Account-Id', (string) $user->id)
            ->getJson('/api/v1/admin/overview')->assertForbidden()->assertJsonPath('error', 'Acceso restringido');
    }

    public function test_anonymous_logout_stays_idempotent_even_with_an_expectation(): void
    {
        $this->withHeader('X-Uvh-Account-Id', '1')->postJson('/api/v1/auth/logout')
            ->assertOk()->assertExactJson(['ok' => true])->assertCookieExpired(config('uvh.session_cookie'));
    }

    public function test_matching_logout_revokes_only_the_cookie_session(): void
    {
        [$user, $token, $id] = $this->account();
        [$other, $otherToken, $otherId] = $this->account();
        $this->withCookie(config('uvh.session_cookie'), $token)->withHeader('X-Uvh-Account-Id', (string) $user->id)
            ->postJson('/api/v1/auth/logout')->assertOk()->assertCookieExpired(config('uvh.session_cookie'));
        $this->assertNotNull(DB::table('sessions')->where('id', $id)->value('revoked_at'));
        $this->assertNull(DB::table('sessions')->where('id', $otherId)->value('revoked_at'));
    }

    public function test_csrf_rejection_is_not_confused_with_a_session_conflict(): void
    {
        [$user, $token] = $this->account();
        $this->withCookie(config('uvh.session_cookie'), $token)->withHeader('X-Uvh-Account-Id', '999')
            ->withHeader('X-CSRF-Token', 'wrong')->patchJson('/api/v1/auth/profile', ['name' => 'Rejected'])
            ->assertForbidden()->assertJsonPath('reason', 'csrf_rejected');
    }

    public function test_public_bearer_routes_use_token_authority_despite_conflicting_cookie_and_header(): void
    {
        [$cookieOwner, $token] = $this->account();
        [$bearerOwner] = $this->account();
        $workspace = $bearerOwner->ownedWorkspaces()->create(['name' => 'Bearer workspace', 'slug' => 'bearer-account-fixture']);
        $workspace->memberships()->create(['user_id' => $bearerOwner->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 7]);
        ApiToken::create(['workspace_id' => $workspace->id, 'name' => 'Fixture', 'token_hash' => Ids::sha256Hex('expected-account-bearer'),
            'scopes' => ['links:read'], 'created_by' => $bearerOwner->id]);
        $this->withCookie(config('uvh.session_cookie'), $token)->withHeader('X-Uvh-Account-Id', 'malformed')
            ->withHeader('Authorization', 'Bearer expected-account-bearer')->getJson('/api/v1/public/links')->assertOk();
        $this->withHeader('Authorization', 'Bearer invalid')->getJson('/api/v1/public/links')->assertUnauthorized();
    }

    public function test_public_verification_keeps_its_token_validation_despite_conflicting_context(): void
    {
        [$user, $token] = $this->account();
        $this->withCookie(config('uvh.session_cookie'), $token)->withHeader('X-Uvh-Account-Id', '999')
            ->postJson('/api/v1/auth/verify-email', ['token' => 'invalid'])->assertStatus(422)->assertJsonPath('error', 'Token inválido');
    }
}
