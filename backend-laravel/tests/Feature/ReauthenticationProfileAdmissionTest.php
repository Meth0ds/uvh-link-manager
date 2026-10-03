<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Models\User;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\Totp;
use App\Support\UvhCrypto;
use App\Support\UvhRequest;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class ReauthenticationProfileAdmissionTest extends TestCase
{
    private const PASSWORD = 'orbit-copper-magnolia-73';

    private const RECOVERY = 'ABCD2345EFGH6789';

    private const SECRET = 'JBSWY3DPEHPK3PXP';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, mail_outbox, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'profile-reauth')->withHeader('X-CSRF-Token', 'profile-reauth');
    }

    private function account(): array
    {
        $user = User::factory()->create(['password_hash' => Hash::make(self::PASSWORD), 'mfa_enabled' => true, 'mfa_secret' => UvhCrypto::encryptAtRest(self::SECRET), 'recovery_codes' => [Ids::sha256Hex(self::RECOVERY)]]);
        $token = SessionManager::create($user->id, Request::create('/'), 1, true);
        $id = Ids::sha256Hex($token);
        DB::table('sessions')->where('id', $id)->update(['mfa_verified_at' => now()->subHour()]);

        return [$user, $token, $id];
    }

    public static function staleActors(): array
    {
        $cases = [];
        foreach (['reauth', 'profile'] as $action) {
            foreach (['expired', 'revoked', 'version', 'unverified', 'blocked', 'foreign-session'] as $reason) {
                $cases[$action.' '.$reason] = [$action, $reason];
            }
        }

        return $cases;
    }

    #[DataProvider('staleActors')]
    public function test_pre_authorized_requests_revalidate_identity_and_session(string $action, string $reason): void
    {
        [$user, $token, $id] = $this->account();
        $snapshot = clone $user;
        match ($reason) {
            'expired' => DB::table('sessions')->where('id', $id)->update(['expires_at' => now()->subSecond()]),
            'revoked' => DB::table('sessions')->where('id', $id)->update(['revoked_at' => now()]),
            'unverified' => DB::table('users')->where('id', $user->id)->update(['email_verified_at' => null]),
            'blocked' => DB::table('users')->where('id', $user->id)->update(['deleted_at' => now()]),
            'foreign-session' => DB::table('sessions')->where('id', $id)->update(['user_id' => User::factory()->create()->id]),
            'version' => $this->rotateGeneration($user, $id),
        };
        $before = $user->refresh()->getAttributes();
        $sessionBefore = DB::table('sessions')->where('id', $id)->first();
        $request = Request::create('/', 'POST', $action === 'profile' ? ['name' => 'Changed Profile'] : ['password' => self::PASSWORD, 'factorCode' => self::RECOVERY]);
        $request->attributes->set(UvhRequest::USER, $snapshot);
        $request->attributes->set(UvhRequest::SESSION_ID, $id);
        $controller = app(AuthController::class);
        $response = $action === 'profile' ? $controller->profile($request) : $controller->mfaReauthenticate($request);
        $this->assertSame(409, $response->getStatusCode());
        $this->assertSame($before, $user->refresh()->getAttributes());
        $this->assertEquals($sessionBefore, DB::table('sessions')->where('id', $id)->first());
        $this->assertDatabaseCount('audit_events', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
    }

    private function rotateGeneration(User $user, string $id): void
    {
        DB::table('users')->where('id', $user->id)->update(['security_version' => 2]);
        DB::table('sessions')->where('id', $id)->update(['security_version' => 2]);
    }

    public static function auditCases(): array
    {
        return ['reauth admission' => ['reauth', true], 'reauth history' => ['reauth', false], 'profile admission' => ['profile', true], 'profile history' => ['profile', false], 'reauth TOTP admission' => ['reauth', true, 'totp'], 'reauth TOTP history' => ['reauth', false, 'totp']];
    }

    #[DataProvider('auditCases')]
    public function test_exact_event_and_mutation_share_one_commit(string $action, bool $fail, string $factor = 'recovery'): void
    {
        [$user, $token, $id] = $this->account();
        $before = $user->refresh()->getAttributes();
        $verifiedBefore = DB::table('sessions')->where('id', $id)->value('mfa_verified_at');
        $event = $action === 'profile' ? 'auth.profile_update' : 'auth.mfa_reauthenticated';
        $factorCode = $factor === 'totp' ? (string) Totp::currentCode(self::SECRET) : self::RECOVERY;
        if ($fail) {
            DB::listen(static function (QueryExecuted $query) use ($event): void {
                if (str_starts_with(strtolower($query->sql), 'insert') && str_contains($query->sql, '"audit_outbox"')) {
                    foreach ($query->bindings as $binding) {
                        if (is_string($binding) && str_contains($binding, '"action":"'.$event.'"')) {
                            throw new \RuntimeException('Fixture: profile/reauth admission unavailable');
                        }
                    }
                }
            });
        } else {
            Schema::rename('audit_events', 'audit_events_unavailable');
        }
        try {
            $this->withCookie('uvh_session', $token);
            $response = $action === 'profile'
                ? $this->patchJson('/api/v1/auth/profile', ['name' => 'Changed Profile'])
                : $this->postJson('/api/v1/auth/mfa/reauthenticate', ['password' => self::PASSWORD, 'factorCode' => $factorCode]);
            if ($fail) {
                $response->assertServerError();
                $this->assertSame($before, $user->refresh()->getAttributes());
                $this->assertSame($verifiedBefore, DB::table('sessions')->where('id', $id)->value('mfa_verified_at'));
                $this->assertDatabaseCount('audit_outbox', 0);
            } else {
                $response->assertOk();
                $exact = DB::table('audit_outbox')->get()->map(static fn ($row) => json_decode($row->event, true, flags: JSON_THROW_ON_ERROR))->where('action', $event)->values();
                $this->assertCount(1, $exact);
                $this->assertSame($user->id, $exact[0]['user_id']);
                foreach ([self::PASSWORD, self::RECOVERY, $token] as $secret) {
                    $this->assertStringNotContainsString($secret, json_encode($exact[0], JSON_THROW_ON_ERROR));
                }
                if ($action === 'profile') {
                    $this->assertSame('Changed Profile', $user->refresh()->name);
                } else {
                    $this->assertSame($factor === 'recovery' ? [] : [Ids::sha256Hex(self::RECOVERY)], $user->refresh()->recovery_codes);
                    $this->assertNotEquals($verifiedBefore, DB::table('sessions')->where('id', $id)->value('mfa_verified_at'));
                }
            }
            if ($factor === 'totp') {
                // SQL rollback cannot restore a spent TOTP counter for replay.
                $counter = Totp::matchingCounter($factorCode, self::SECRET);
                $this->assertTrue(Cache::has('uvh:mfa:totp-used:'.$user->id.':'.substr(hash('sha256', self::SECRET), 0, 24).':'.$counter));
            }
        } finally {
            if (! $fail) {
                Schema::rename('audit_events_unavailable', 'audit_events');
            }
        }
        if (! $fail) {
            $this->assertTrue(Audit::drain());
            $this->assertTrue(Audit::drain());
            $this->assertSame(1, DB::table('audit_events')->where('action', $event)->count());
        }
    }

    public static function sessionDeadlines(): array
    {
        return [['reauth', 1], ['reauth', 0], ['reauth', -1], ['profile', 1], ['profile', 0], ['profile', -1]];
    }

    #[DataProvider('sessionDeadlines')]
    public function test_session_deadline_is_exclusive_under_the_mutation_lock(string $action, int $seconds): void
    {
        $this->travelTo(now()->startOfSecond());
        [$user, $token, $id] = $this->account();
        $snapshot = clone $user;
        DB::table('sessions')->where('id', $id)->update(['expires_at' => now()->addSeconds($seconds)]);
        $before = $user->refresh()->getRawOriginal();
        $sessionBefore = DB::table('sessions')->where('id', $id)->first();
        $request = Request::create('/', 'POST', $action === 'profile' ? ['name' => 'Changed Profile'] : ['password' => self::PASSWORD, 'factorCode' => self::RECOVERY]);
        $request->attributes->set(UvhRequest::USER, $snapshot);
        $request->attributes->set(UvhRequest::SESSION_ID, $id);
        $controller = app(AuthController::class);
        $response = $action === 'profile' ? $controller->profile($request) : $controller->mfaReauthenticate($request);
        $this->assertSame($seconds > 0 ? 200 : 409, $response->getStatusCode());
        if ($seconds <= 0) {
            $this->assertSame($before, $user->refresh()->getRawOriginal());
            $this->assertEquals($sessionBefore, DB::table('sessions')->where('id', $id)->first());
            $this->assertDatabaseCount('audit_events', 0);
            $this->assertDatabaseCount('audit_outbox', 0);
        } else {
            $this->assertSame($action === 'profile' ? 'Changed Profile' : $user->name, $user->refresh()->name);
            $this->assertSame($action === 'reauth' ? [] : [Ids::sha256Hex(self::RECOVERY)], $user->recovery_codes);
        }
    }

    public static function outerCommits(): array
    {
        $cases = [];
        foreach (['profile', 'recovery', 'totp'] as $action) {
            foreach ([false, true] as $commit) {
                $cases[$action.' '.($commit ? 'commit' : 'rollback')] = [$action, $commit];
            }
        }

        return $cases;
    }

    #[DataProvider('outerCommits')]
    public function test_outer_commit_owns_profile_or_freshness_recovery_and_exact_event(string $action, bool $commit): void
    {
        $this->travelTo(now()->startOfSecond());
        [$user, $token, $id] = $this->account();
        SessionManager::create($user->id, Request::create('/'), 1, true);
        $before = $user->refresh()->getRawOriginal();
        $sessionsBefore = DB::table('sessions')->orderBy('id')->get()->toJson();
        $verifiedBefore = DB::table('sessions')->where('id', $id)->value('mfa_verified_at');
        $event = $action === 'profile' ? 'auth.profile_update' : 'auth.mfa_reauthenticated';
        $factor = $action === 'totp' ? (string) Totp::currentCode(self::SECRET) : self::RECOVERY;
        $this->withCookie('uvh_session', $token)->withServerVariables(['REMOTE_ADDR' => '192.0.2.5']);
        $call = fn () => $action === 'profile'
            ? $this->patchJson('/api/v1/auth/profile', ['name' => 'Changed Profile'])
            : $this->postJson('/api/v1/auth/mfa/reauthenticate', ['password' => self::PASSWORD, 'factorCode' => $factor]);
        DB::beginTransaction();
        try {
            $call()->assertOk();
            $this->assertDatabaseCount('audit_outbox', 1);
            $this->assertDatabaseCount('audit_events', 0);
            $this->assertSame(1, $user->refresh()->security_version);
            $this->assertSame(2, DB::table('sessions')->whereNull('revoked_at')->count());
            $this->assertDatabaseCount('mail_outbox', 0);
            $pending = json_decode(DB::table('audit_outbox')->sole()->event, true, flags: JSON_THROW_ON_ERROR);
            $this->assertSame($event, $pending['action']);
            $this->assertSame($action === 'profile' ? null : UvhCrypto::hashIp('192.0.2.5'), $pending['ip_hash']);
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
            $this->assertSame($before, $user->refresh()->getRawOriginal());
            $this->assertSame($sessionsBefore, DB::table('sessions')->orderBy('id')->get()->toJson());
            $this->assertDatabaseCount('audit_outbox', 0);
            $this->assertDatabaseCount('audit_events', 0);
            if ($action === 'totp') {
                $counter = Totp::matchingCounter($factor, self::SECRET);
                $this->assertTrue(Cache::has('uvh:mfa:totp-used:'.$user->id.':'.substr(hash('sha256', self::SECRET), 0, 24).':'.$counter));
                $call()->assertStatus(403);
                $this->assertSame($verifiedBefore, DB::table('sessions')->where('id', $id)->value('mfa_verified_at'));
                $this->assertSame(0, DB::table('audit_events')->where('action', $event)->count());

                return;
            }
            $call()->assertOk();
        }
        $this->assertSame(1, $user->refresh()->security_version);
        $this->assertSame(2, DB::table('sessions')->whereNull('revoked_at')->count());
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertSame(1, DB::table('audit_events')->where('action', $event)->count());
        $row = DB::table('audit_events')->where('action', $event)->sole();
        $this->assertSame($action === 'profile' ? null : UvhCrypto::hashIp('192.0.2.5'), $row->ip_hash);
        foreach ([self::PASSWORD, self::RECOVERY, $token, self::SECRET, '192.0.2.5'] as $secret) {
            $this->assertStringNotContainsString($secret, json_encode($row, JSON_THROW_ON_ERROR));
        }
        if ($action === 'profile') {
            $this->assertSame('Changed Profile', $user->name);
            $this->assertSame($verifiedBefore, DB::table('sessions')->where('id', $id)->value('mfa_verified_at'));
            $this->assertSame([Ids::sha256Hex(self::RECOVERY)], $user->recovery_codes);
        } else {
            $this->assertSame($action === 'recovery' ? [] : [Ids::sha256Hex(self::RECOVERY)], $user->recovery_codes);
            $this->assertNotEquals($verifiedBefore, DB::table('sessions')->where('id', $id)->value('mfa_verified_at'));
            $this->assertSame($action, json_decode($row->metadata, true, flags: JSON_THROW_ON_ERROR)['factor']);
        }
    }
}
