<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class SessionHydrationBoundaryTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'session-boundary')->withHeader('X-CSRF-Token', 'session-boundary');
    }

    private function account(): array
    {
        $user = User::factory()->create();
        $token = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version);
        $request = Request::create('/', 'GET', [], [config('uvh.session_cookie') => $token]);

        return [$user, $token, Ids::sha256Hex($token), $request];
    }

    public function test_account_blocked_between_session_and_owner_queries_is_rejected(): void
    {
        [$user, $token, $id, $request] = $this->account();
        $blocked = false;
        DB::listen(function (QueryExecuted $query) use ($user, &$blocked): void {
            if (! $blocked && str_starts_with($query->sql, 'select') && str_contains($query->sql, 'from "sessions"')) {
                $blocked = true;
                DB::table('users')->where('id', $user->id)->update(['deleted_at' => now()]);
            }
        });

        $context = SessionManager::hydrate($request);
        $this->assertTrue($blocked, 'The interleaving must run after the session SELECT and before eager owner loading.');
        $this->assertNull($context);
    }

    public static function expiryBoundaries(): array
    {
        return ['past' => [-1, false], 'exact deadline' => [0, false], 'future' => [1, true]];
    }

    #[DataProvider('expiryBoundaries')]
    public function test_expiry_boundary_matches_authenticated_read_contract(int $seconds, bool $valid): void
    {
        $this->freezeSecond();
        try {
            [$user, $token, $id, $request] = $this->account();
            DB::table('sessions')->where('id', $id)->update(['expires_at' => now()->addSeconds($seconds)]);
            $context = SessionManager::hydrate($request);
            $this->assertSame($valid, $context !== null);
            if ($valid) {
                $this->assertSame($user->id, $context['user']->id);
                $this->assertSame($id, $context['session_id']);
            }
        } finally {
            $this->travelBack();
        }
    }

    public function test_logout_still_revokes_session_when_exact_audit_admission_fails(): void
    {
        [$user, $token, $id] = $this->account();
        $attempted = false;
        DB::listen(function (QueryExecuted $query) use (&$attempted): void {
            if (str_starts_with($query->sql, 'insert into "audit_outbox"')) {
                $attempted = true;
                throw new \RuntimeException('Injected logout audit admission failure');
            }
        });

        $response = $this->withCookie(config('uvh.session_cookie'), $token)->postJson('/api/v1/auth/logout');
        $response->assertOk()->assertExactJson(['ok' => true]);
        $this->assertTrue($attempted);
        $this->assertNotNull(DB::table('sessions')->where('id', $id)->value('revoked_at'));
        $response->assertCookieExpired(config('uvh.session_cookie'));
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('audit_events', 0);
        $this->assertNull(SessionManager::hydrate(Request::create('/', 'GET', [], [config('uvh.session_cookie') => $token])));
    }

    public function test_logout_keeps_materializable_event_when_history_is_unavailable(): void
    {
        [$user, $token, $id] = $this->account();
        Schema::rename('audit_events', 'audit_events_session_boundary');
        try {
            $response = $this->withCookie(config('uvh.session_cookie'), $token)->postJson('/api/v1/auth/logout');
            $response->assertOk()->assertCookieExpired(config('uvh.session_cookie'));
            $this->assertNotNull(DB::table('sessions')->where('id', $id)->value('revoked_at'));
            $event = json_decode(DB::table('audit_outbox')->sole()->event, true, flags: JSON_THROW_ON_ERROR);
            $this->assertSame('auth.logout', $event['action']);
            $this->assertSame($id, $event['resource_id']);
            $this->assertSame($user->id, $event['user_id']);
        } finally {
            Schema::rename('audit_events_session_boundary', 'audit_events');
        }
        $this->assertTrue(Audit::drain());
        $this->assertTrue(Audit::drain());
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'auth.logout')->count());
    }

    public function test_anonymous_logout_is_idempotent_and_clears_cookie(): void
    {
        $this->postJson('/api/v1/auth/logout')->assertOk()->assertExactJson(['ok' => true])->assertCookieExpired(config('uvh.session_cookie'));
        $this->assertDatabaseCount('sessions', 0);
        $this->assertDatabaseCount('audit_events', 0);
    }
}
