<?php

namespace Tests\Feature;

use App\Jobs\DeliverMailOutboxJob;
use App\Models\AccountRecoveryRequest;
use App\Models\User;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\Totp;
use App\Support\UvhCrypto;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class MfaConfigurationAdmissionTest extends TestCase
{
    private const PASSWORD = 'tiovivo-cobrizo-astilla-42';

    private const CODE = 'ABCD2345EFGH6789';

    private const SECRET = 'JBSWY3DPEHPK3PXP';

    private const PENDING = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

    private const ACTIONS = ['setup', 'cancel', 'enable', 'reconfigure', 'regenerate', 'disable'];

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, mail_outbox, audit_events, audit_outbox, operational_metrics RESTART IDENTITY CASCADE');
        Queue::fake();
        $this->travelTo(now()->startOfSecond());
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'mfa-admission')->withHeader('X-CSRF-Token', 'mfa-admission');
    }

    private function owner(string $action): User
    {
        $active = $action !== 'enable';

        return User::factory()->create(['password_hash' => Hash::make(self::PASSWORD),
            'mfa_enabled' => $active, 'mfa_secret' => $active ? UvhCrypto::encryptAtRest(self::SECRET) : null,
            'recovery_codes' => $active ? [Ids::sha256Hex(self::CODE)] : null,
            'mfa_pending_secret' => UvhCrypto::encryptAtRest(self::PENDING),
            'mfa_pending_expires_at' => now()->addMinutes(10)])->refresh();
    }

    private function useSession(User $owner): string
    {
        $token = SessionManager::create($owner->id, Request::create('/'), 1, (bool) $owner->mfa_enabled);
        $id = Ids::sha256Hex($token);
        DB::table('sessions')->where('id', $id)->update(['mfa_verified_at' => $owner->mfa_enabled ? now()->subSeconds(10) : null]);
        $this->withCookie('uvh_session', $token);

        return $id;
    }

    private function callAction(string $action, ?string $pendingCode = null)
    {
        return match ($action) {
            'setup' => $this->postJson('/api/v1/auth/mfa/setup', ['password' => self::PASSWORD, 'code' => self::CODE]),
            'cancel' => $this->postJson('/api/v1/auth/mfa/cancel-setup', []),
            'enable', 'reconfigure' => $this->postJson('/api/v1/auth/mfa/enable', ['code' => $pendingCode ?? Totp::currentCode(self::PENDING)]),
            'regenerate' => $this->postJson('/api/v1/auth/mfa/recovery-codes/regenerate', ['password' => self::PASSWORD, 'factorCode' => self::CODE]),
            'disable' => $this->postJson('/api/v1/auth/mfa/disable', ['password' => self::PASSWORD, 'code' => self::CODE]),
        };
    }

    private function exactAction(string $action): string
    {
        return match ($action) {
            'setup' => 'auth.mfa_setup', 'cancel' => 'auth.mfa_setup_cancel',
            'enable' => 'auth.mfa_enable', 'reconfigure' => 'auth.mfa_reconfigured',
            'regenerate' => 'auth.mfa_recovery_regenerate', 'disable' => 'auth.mfa_disable',
        };
    }

    public static function liveChanges(): array
    {
        $cases = [];
        foreach (self::ACTIONS as $action) {
            foreach (['blocked', 'revoked', 'expiry_equal', 'session_version', 'foreign'] as $change) {
                $cases[$action.' '.$change] = [$action, $change];
            }
        }

        return $cases;
    }

    #[DataProvider('liveChanges')]
    public function test_live_authority_is_rechecked_after_real_session_hydration(string $action, string $change): void
    {
        $owner = $this->owner($action);
        $foreign = User::factory()->create();
        $sessionId = $this->useSession($owner);
        DB::table('sessions')->where('id', $sessionId)->update(['last_used_at' => now()->subMinutes(2)]);
        $changed = false;
        $after = null;
        $sessionsAfter = null;
        DB::listen(static function (QueryExecuted $query) use ($owner, $foreign, $sessionId, $change, &$changed, &$after, &$sessionsAfter): void {
            if ($changed || ! str_starts_with($query->sql, 'update "sessions"') || ! str_contains($query->sql, '"last_used_at"')) {
                return;
            }
            $changed = true;
            if ($change === 'blocked') {
                DB::table('users')->where('id', $owner->id)->update(['deleted_at' => now()]);
            } else {
                DB::table('sessions')->where('id', $sessionId)->update(match ($change) {
                    'revoked' => ['revoked_at' => now()], 'expiry_equal' => ['expires_at' => now()],
                    'session_version' => ['security_version' => 2], default => ['user_id' => $foreign->id],
                });
            }
            $after = DB::table('users')->where('id', $owner->id)->first();
            $sessionsAfter = DB::table('sessions')->orderBy('id')->get()->toJson();
        });
        $code = Totp::currentCode(self::PENDING);
        $this->callAction($action, $code)->assertStatus(409)->assertJsonMissingPath('secret')->assertJsonMissingPath('recoveryCodes');
        $this->assertTrue($changed);
        $this->assertEquals($after, DB::table('users')->where('id', $owner->id)->first());
        $this->assertSame($sessionsAfter, DB::table('sessions')->orderBy('id')->get()->toJson());
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertDatabaseCount('notifications', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertSame(0, DB::table('audit_events')->where('action', $this->exactAction($action))->count());
        if (in_array($action, ['enable', 'reconfigure'], true)) {
            $factor = substr(hash('sha256', self::PENDING), 0, 24);
            $this->assertFalse(Cache::has('uvh:mfa:totp-used:'.$owner->id.':'.$factor.':'.Totp::matchingCounter($code, self::PENDING)));
        }
        Queue::assertNothingPushed();
    }

    public static function outerCommits(): array
    {
        $cases = [];
        foreach (self::ACTIONS as $action) {
            foreach ([false, true] as $commit) {
                $cases[$action.' '.($commit ? 'commit' : 'rollback')] = [$action, $commit];
            }
        }

        return $cases;
    }

    #[DataProvider('outerCommits')]
    public function test_outer_commit_owns_factor_session_case_notice_and_exact_audit(string $action, bool $commit): void
    {
        $owner = $this->owner($action);
        $current = $this->useSession($owner);
        $other = Ids::sha256Hex(SessionManager::create($owner->id, Request::create('/'), 1, (bool) $owner->mfa_enabled));
        $case = AccountRecoveryRequest::create(['user_id' => $owner->id, 'security_version' => 1, 'status' => 'requested', 'expires_at' => now()->addDay()]);
        $before = $owner->getRawOriginal();
        $sessionsBefore = DB::table('sessions')->orderBy('id')->get()->toJson();
        $mutatesGeneration = ! in_array($action, ['setup', 'cancel'], true);
        $pendingCode = Totp::currentCode(self::PENDING);
        DB::beginTransaction();
        try {
            $response = $this->callAction($action, $pendingCode)->assertOk();
            $this->assertSame($mutatesGeneration ? 2 : 1, $owner->refresh()->security_version);
            $this->assertSame($mutatesGeneration ? 'cancelled' : 'requested', $case->refresh()->status);
            $this->assertDatabaseCount('mail_outbox', $mutatesGeneration ? 1 : 0);
            $this->assertDatabaseCount('notifications', $mutatesGeneration ? 1 : 0);
            $this->assertDatabaseCount('audit_outbox', 1);
            $event = DB::table('audit_outbox')->sole();
            $this->assertSame($this->exactAction($action), json_decode($event->event, true, flags: JSON_THROW_ON_ERROR)['action']);
            $this->assertDatabaseCount('audit_events', 0);
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
            $this->assertSame($before, $owner->refresh()->getRawOriginal());
            $this->assertSame($sessionsBefore, DB::table('sessions')->orderBy('id')->get()->toJson());
            $this->assertSame('requested', $case->refresh()->status);
            $this->assertDatabaseCount('mail_outbox', 0);
            $this->assertDatabaseCount('notifications', 0);
            $this->assertDatabaseCount('audit_outbox', 0);
            $this->assertDatabaseCount('audit_events', 0);
            Queue::assertNothingPushed();
            if (in_array($action, ['enable', 'reconfigure'], true)) {
                // SQL rollback cannot undo the independent replay claim. This
                // exact proof remains spent; do not reset cache to fake retry.
                $factor = substr(hash('sha256', self::PENDING), 0, 24);
                $this->assertTrue(Cache::has('uvh:mfa:totp-used:'.$owner->id.':'.$factor.':'.Totp::matchingCounter($pendingCode, self::PENDING)));
                $this->callAction($action, $pendingCode)->assertStatus(403);
                $this->assertSame($before, $owner->refresh()->getRawOriginal());
                $this->assertSame(0, DB::table('audit_events')->where('action', $this->exactAction($action))->count());

                return;
            }
            $response = $this->callAction($action)->assertOk();
        }
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertSame(1, DB::table('audit_events')->where('action', $this->exactAction($action))->count());
        $this->assertDatabaseHas('sessions', ['id' => $current, 'security_version' => $mutatesGeneration ? 2 : 1, 'revoked_at' => null]);
        $this->assertSame($mutatesGeneration, DB::table('sessions')->where('id', $other)->value('revoked_at') !== null);
        $this->assertDatabaseCount('mail_outbox', $mutatesGeneration ? 1 : 0);
        $this->assertSame($mutatesGeneration ? 'cancelled' : 'requested', $case->refresh()->status);
        if ($mutatesGeneration) {
            Queue::assertPushed(DeliverMailOutboxJob::class, 1);
        } else {
            Queue::assertNothingPushed();
        }
        $owner->refresh();
        if ($action === 'setup') {
            $this->assertSame($response->json('secret'), UvhCrypto::decryptAtRest($owner->mfa_pending_secret));
            $this->assertSame(self::SECRET, UvhCrypto::decryptAtRest($owner->mfa_secret));
            $this->assertSame([], $owner->recovery_codes);
        } elseif ($action === 'cancel') {
            $this->assertNull($owner->mfa_pending_secret);
            $this->assertSame(self::SECRET, UvhCrypto::decryptAtRest($owner->mfa_secret));
            $this->assertSame([Ids::sha256Hex(self::CODE)], $owner->recovery_codes);
        } elseif ($action === 'disable') {
            $this->assertFalse($owner->mfa_enabled);
            $this->assertNull($owner->mfa_secret);
            $this->assertNull($owner->recovery_codes);
            $this->assertNull(DB::table('sessions')->where('id', $current)->value('mfa_verified_at'));
        } else {
            $response->assertJsonCount(10, 'recoveryCodes');
            $codes = array_map(static fn (string $code): string => str_replace('-', '', $code), $response->json('recoveryCodes'));
            $this->assertSame(array_map([Ids::class, 'sha256Hex'], $codes), $owner->recovery_codes);
            $this->assertTrue($owner->mfa_enabled);
            $this->assertSame($action === 'regenerate' ? self::SECRET : self::PENDING, UvhCrypto::decryptAtRest($owner->mfa_secret));
        }
    }
}
