<?php

namespace Tests\Feature;

use App\Jobs\DeliverMailOutboxJob;
use App\Models\EmailToken;
use App\Models\User;
use App\Support\Ids;
use App\Support\MailDeliveryEligibility;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class PasswordRecoveryAdmissionTest extends TestCase
{
    private const PASSWORD = 'brujula-limonero-zafiro-93';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, email_tokens, mail_outbox, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        Queue::fake();
        config(['uvh.password_reset_min_duration_ms' => 0]);
        $this->travelTo(now()->startOfSecond());
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'recovery-fixture')->withHeader('X-CSRF-Token', 'recovery-fixture');
    }

    public static function cooldowns(): array
    {
        $cases = [];
        foreach ([59, 60, 61] as $seconds) {
            foreach ([false, true] as $used) {
                $cases[$seconds.($used ? ' used' : ' unused')] = [$seconds, $used];
            }
        }

        return $cases;
    }

    #[DataProvider('cooldowns')]
    public function test_cooldown_is_account_scoped_and_includes_used_bearers(int $seconds, bool $used): void
    {
        $user = User::factory()->create();
        $previous = $this->bearer($user);
        DB::table('email_tokens')->where('id', Ids::sha256Hex($previous))->update([
            'created_at' => now()->subSeconds($seconds), 'used_at' => $used ? now()->subSecond() : null,
        ]);
        $this->postJson('/api/v1/auth/forgot-password', ['email' => strtoupper($user->email), 'captchaToken' => 'fixture'])
            ->assertOk()->assertExactJson(['ok' => true]);
        if ($seconds < 60) {
            $this->assertDatabaseCount('email_tokens', 1);
            $this->assertDatabaseCount('mail_outbox', 0);
            Queue::assertNothingPushed();
        } else {
            $this->assertDatabaseCount('email_tokens', $used ? 2 : 1);
            $this->assertSame(1, EmailToken::where('kind', 'reset')->whereNull('used_at')->count());
            $this->assertDatabaseCount('mail_outbox', 1);
            $this->assertTrue(MailDeliveryEligibility::isCurrent(DB::table('mail_outbox')->first()));
            Queue::assertPushed(DeliverMailOutboxJob::class, 1);
        }
    }

    public static function requestRaces(): array
    {
        return ['email changed' => ['email'], 'unverified' => ['unverified'], 'deleted' => ['deleted']];
    }

    #[DataProvider('requestRaces')]
    public function test_lookup_does_not_authorize_mail_after_account_changes(string $change): void
    {
        $user = User::factory()->create();
        $armed = true;
        $observed = false;
        DB::listen(static function (QueryExecuted $query) use ($user, $change, &$armed, &$observed): void {
            if (! $armed || ! str_starts_with($query->sql, 'select')
                || ! str_contains($query->sql, 'from "users"') || ! str_contains($query->sql, 'lower(email)')) {
                return;
            }
            $armed = false;
            $observed = true;
            DB::table('users')->where('id', $user->id)->update(match ($change) {
                'email' => ['email' => 'changed@example.test'],
                'unverified' => ['email_verified_at' => null],
                'deleted' => ['deleted_at' => now()],
            });
        });
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email, 'captchaToken' => 'fixture'])
            ->assertOk()->assertExactJson(['ok' => true]);
        $this->assertTrue($observed);
        $this->assertDatabaseCount('email_tokens', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();
    }

    public static function resetRaces(): array
    {
        return [
            'consumed' => ['consumed', 400], 'wrong kind' => ['kind', 400], 'other owner' => ['owner', 400],
            'expired' => ['expired', 400], 'deleted' => ['deleted', 400], 'unverified' => ['unverified', 400],
            'live name' => ['name', 422],
        ];
    }

    #[DataProvider('resetRaces')]
    public function test_reset_revalidates_bearer_and_account_under_lock(string $change, int $status): void
    {
        $user = User::factory()->create(['name' => 'Original Person', 'email' => 'original@example.test']);
        $foreign = User::factory()->create();
        $foreignBefore = $foreign->refresh()->getRawOriginal();
        $plain = $this->bearer($user);
        $hash = Ids::sha256Hex($plain);
        $armed = true;
        $before = null;
        $tokenBefore = null;
        DB::listen(static function (QueryExecuted $query) use ($user, $foreign, $hash, $change, &$armed, &$before, &$tokenBefore): void {
            if (! $armed || ! str_starts_with($query->sql, 'select')
                || ! str_contains($query->sql, 'from "email_tokens"') || str_contains($query->sql, 'for update')) {
                return;
            }
            $armed = false;
            if (in_array($change, ['consumed', 'kind', 'owner', 'expired'], true)) {
                DB::table('email_tokens')->where('id', $hash)->update(match ($change) {
                    'consumed' => ['used_at' => now()], 'kind' => ['kind' => 'security_revoke'],
                    'owner' => ['user_id' => $foreign->id], 'expired' => ['expires_at' => now()],
                });
            } else {
                DB::table('users')->where('id', $user->id)->update(match ($change) {
                    'deleted' => ['deleted_at' => now()], 'unverified' => ['email_verified_at' => null],
                    'name' => ['name' => 'Brujula'],
                });
            }
            $before = $user->refresh()->getRawOriginal();
            $tokenBefore = EmailToken::findOrFail($hash)->getRawOriginal();
        });
        $this->postJson('/api/v1/auth/reset-password', ['token' => $plain, 'password' => self::PASSWORD])
            ->assertStatus($status)->assertJsonPath('error', $status === 422 ? 'La contraseña es demasiado débil' : 'Token inválido o caducado');
        $this->assertFalse($armed, 'The fixture must mutate after preflight and before locking.');
        $this->assertSame($before, $user->refresh()->getRawOriginal());
        $this->assertSame($foreignBefore, $foreign->refresh()->getRawOriginal());
        $this->assertSame($tokenBefore, EmailToken::findOrFail($hash)->getRawOriginal());
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('audit_events', 0);
        Queue::assertNothingPushed();
    }

    public function test_success_increments_the_locked_generation_and_consumes_the_bearer_once(): void
    {
        $user = User::factory()->create(['security_version' => 9]);
        $plain = $this->bearer($user);
        $this->postJson('/api/v1/auth/reset-password', ['token' => $plain, 'password' => self::PASSWORD])
            ->assertOk()->assertExactJson(['ok' => true, 'current' => false]);
        $this->assertSame(10, (int) $user->refresh()->security_version);
        $this->assertTrue(Hash::check(self::PASSWORD, $user->password_hash));
        $this->assertNotNull(EmailToken::findOrFail(Ids::sha256Hex($plain))->used_at);
        $after = $user->getRawOriginal();
        $this->postJson('/api/v1/auth/reset-password', ['token' => $plain, 'password' => self::PASSWORD])->assertStatus(400);
        $this->assertSame($after, $user->refresh()->getRawOriginal());
        $this->assertDatabaseCount('mail_outbox', 1);
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
    }

    private function bearer(User $user): string
    {
        $plain = Ids::randomToken(32);
        EmailToken::create(['id' => Ids::sha256Hex($plain), 'user_id' => $user->id, 'kind' => 'reset', 'expires_at' => now()->addHour()]);

        return $plain;
    }
}
