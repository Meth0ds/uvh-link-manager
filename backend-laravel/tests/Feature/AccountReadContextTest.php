<?php

namespace Tests\Feature;

use App\Http\Controllers\AccountProfileController;
use App\Http\Controllers\AccountSessionsController;
use App\Http\Controllers\MfaSessionController;
use App\Models\User;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use App\Support\UvhRequest;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class AccountReadContextTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
    }

    private function account(): array
    {
        $user = User::factory()->create(['mfa_enabled' => true, 'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP'), 'recovery_codes' => [Ids::sha256Hex('ABCD2345EFGH6789')]]);
        $token = SessionManager::create($user->id, Request::create('/'), 1, true);

        return [$user, $token, Ids::sha256Hex($token)];
    }

    private function request(User $snapshot, string $sessionId): Request
    {
        $request = Request::create('/', 'GET');
        $request->attributes->set(UvhRequest::USER, $snapshot);
        $request->attributes->set(UvhRequest::SESSION_ID, $sessionId);
        $request->attributes->set(UvhRequest::MFA_VERIFIED_AT, now()->subHour());

        return $request;
    }

    public static function staleReads(): array
    {
        $cases = [];
        foreach (['me', 'sessions', 'securityCenter', 'mfaSessionStatus'] as $action) {
            foreach (['blocked', 'unverified', 'deleted', 'expired', 'revoked', 'session-version', 'actor-version', 'foreign-session'] as $reason) {
                $cases[$action.' '.$reason] = [$action, $reason];
            }
        }

        return $cases;
    }

    #[DataProvider('staleReads')]
    public function test_reads_do_not_publish_account_data_from_invalidated_context(string $action, string $reason): void
    {
        [$user, $token, $id] = $this->account();
        $snapshot = clone $user;
        match ($reason) {
            'blocked' => DB::table('users')->where('id', $user->id)->update(['deleted_at' => now()]),
            'unverified' => DB::table('users')->where('id', $user->id)->update(['email_verified_at' => null]),
            'deleted' => $user->delete(),
            'expired' => DB::table('sessions')->where('id', $id)->update(['expires_at' => now()->subSecond()]),
            'revoked' => DB::table('sessions')->where('id', $id)->update(['revoked_at' => now()]),
            'session-version' => DB::table('users')->where('id', $user->id)->update(['security_version' => 2]),
            'actor-version' => $this->rotateBoth($user, $id),
            'foreign-session' => DB::table('sessions')->where('id', $id)->update(['user_id' => User::factory()->create()->id]),
        };
        $response = app(match ($action) {
            'me' => AccountProfileController::class,
            'sessions', 'securityCenter' => AccountSessionsController::class,
            'mfaSessionStatus' => MfaSessionController::class,
        })->{$action}($this->request($snapshot, $id));
        $this->assertSame(401, $response->getStatusCode());
        $this->assertSame(['error' => 'No autenticado'], json_decode($response->getContent(), true, flags: JSON_THROW_ON_ERROR));
        // A delayed old GET must not erase a cookie installed by a newer login.
        $this->assertCount(0, $response->headers->getCookies());
    }

    private function rotateBoth(User $user, string $id): void
    {
        DB::table('users')->where('id', $user->id)->update(['security_version' => 2]);
        DB::table('sessions')->where('id', $id)->update(['security_version' => 2]);
    }

    public static function freshnessReads(): array
    {
        return ['mfa' => ['mfaSessionStatus'], 'security' => ['securityCenter']];
    }

    #[DataProvider('freshnessReads')]
    public function test_mfa_timestamp_comes_from_live_sql_session(string $action): void
    {
        [$user, $token, $id] = $this->account();
        $verified = now()->startOfSecond();
        DB::table('sessions')->where('id', $id)->update(['mfa_verified_at' => $verified]);
        $response = app(match ($action) {
            'me' => AccountProfileController::class,
            'sessions', 'securityCenter' => AccountSessionsController::class,
            'mfaSessionStatus' => MfaSessionController::class,
        })->{$action}($this->request(clone $user, $id));
        $this->assertSame(200, $response->getStatusCode());
        $body = json_decode($response->getContent(), true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame($verified->format('Y-m-d\TH:i:s.v\Z'), $action === 'securityCenter' ? $body['summary']['currentSessionMfaVerifiedAt'] : $body['verifiedAt']);
        if ($action === 'mfaSessionStatus') {
            $this->assertTrue($body['fresh']);
        }
    }

    public function test_me_returns_current_profile_without_credentials(): void
    {
        [$user, $token, $id] = $this->account();
        $snapshot = clone $user;
        DB::table('users')->where('id', $user->id)->update(['name' => 'Current Profile']);
        $response = app(AccountProfileController::class)->me($this->request($snapshot, $id));
        $this->assertSame(200, $response->getStatusCode());
        $body = json_decode($response->getContent(), true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame('Current Profile', $body['user']['name']);
        foreach (['JBSWY3DPEHPK3PXP', 'ABCD2345EFGH6789', $token, 'password_hash', 'mfa_secret', 'recovery_codes'] as $secret) {
            $this->assertStringNotContainsString($secret, $response->getContent());
        }
    }

    public static function volumes(): array
    {
        return ['one session' => [0], 'exact boundary' => [99], 'over boundary' => [105]];
    }

    #[DataProvider('volumes')]
    public function test_bounded_sessions_keep_current_first_and_other_rows_stable(int $otherCount): void
    {
        [$user, $token, $id] = $this->account();
        DB::table('sessions')->where('id', $id)->update(['last_used_at' => now()->subDay()]);
        $lastUsed = now()->startOfSecond();
        $others = [];
        for ($index = 0; $index < $otherCount; $index++) {
            $otherId = hash('sha256', 'other-session-'.$index);
            $others[] = $otherId;
            DB::table('sessions')->insert(['id' => $otherId, 'user_id' => $user->id, 'security_version' => 1, 'created_at' => now(), 'last_used_at' => $lastUsed, 'expires_at' => now()->addDay()]);
        }
        $foreign = User::factory()->create();
        SessionManager::create($foreign->id, Request::create('/'), 1);
        $response = app(AccountSessionsController::class)->sessions($this->request($user, $id));
        $this->assertSame(200, $response->getStatusCode());
        $body = json_decode($response->getContent(), true, flags: JSON_THROW_ON_ERROR);
        $this->assertCount(min(100, $otherCount + 1), $body['sessions']);
        $this->assertSame($otherCount + 1 > 100, $body['truncated']);
        $this->assertSame($id, $body['sessions'][0]['id']);
        $this->assertCount(1, array_filter($body['sessions'], static fn ($row) => $row['current']));
        rsort($others);
        $this->assertSame(array_slice($others, 0, 99), array_slice(array_column($body['sessions'], 'id'), 1));
    }

    public static function readRoutes(): array
    {
        return [['me'], ['mfa/session'], ['sessions'], ['security-center']];
    }

    #[DataProvider('readRoutes')]
    public function test_real_reads_refresh_context_without_mutation_locks(string $route): void
    {
        [$user, $token] = $this->account();
        $before = $user->refresh()->getRawOriginal();
        $locks = [];
        $levels = [];
        DB::listen(static function (QueryExecuted $query) use (&$locks, &$levels): void {
            if (str_contains(strtolower($query->sql), 'for update')) {
                $locks[] = $query->sql;
            }
            if (str_starts_with(strtolower($query->sql), 'select')
                && preg_match('/from "(?:users|sessions|audit_events)"/', $query->sql)) {
                $levels[] = $query->connection->transactionLevel();
            }
        });
        $response = $this->withCookie('uvh_session', $token)
            ->withCookie((string) config('uvh.csrf_cookie'), 'account-read-csrf')
            ->getJson('/api/v1/auth/'.$route)->assertOk();
        $this->assertSame([], $locks);
        $this->assertNotEmpty($levels);
        $this->assertSame([0], array_values(array_unique($levels)));
        $this->assertCount(0, $response->headers->getCookies());
        $this->assertSame($before, $user->refresh()->getRawOriginal());
        $this->assertDatabaseCount('sessions', 1);
        foreach (['JBSWY3DPEHPK3PXP', 'ABCD2345EFGH6789', $token, 'password_hash', 'mfa_secret', 'recovery_codes'] as $secret) {
            $this->assertStringNotContainsString($secret, $response->getContent());
        }
    }
}
