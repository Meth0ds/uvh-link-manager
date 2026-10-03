<?php

namespace Tests\Feature;

use App\Jobs\DeliverMailOutboxJob;
use App\Models\PendingRegistration;
use App\Models\RegistrationAttempt;
use App\Models\User;
use App\Support\Ids;
use App\Support\RegistrationEdit;
use App\Support\SealedToken;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class RegistrationLifecycleAdmissionTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, pending_registrations, mail_outbox, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'lifecycle')->withHeader('X-CSRF-Token', 'lifecycle');
        $this->travelTo(now()->startOfSecond());
        Queue::fake();
        config(['uvh.resend_verification_min_duration_ms' => 0]);
    }

    private function owner(bool $legacy): PendingRegistration|User
    {
        return $legacy
            ? User::factory()->create(['email' => 'original@example.test', 'email_verified_at' => null])
            : PendingRegistration::create(['email' => 'original@example.test', 'security_version' => 1]);
    }

    private function seedBearer(PendingRegistration|User $owner, int $ageSeconds): string
    {
        $hash = Ids::sha256Hex(Ids::randomToken(32));
        DB::table('email_tokens')->insert(['id' => $hash, $owner instanceof User ? 'user_id' : 'pending_registration_id' => $owner->id, 'kind' => 'verify', 'expires_at' => now()->addDay(), 'created_at' => now()->subSeconds($ageSeconds)]);

        return $hash;
    }

    public static function cooldowns(): array
    {
        $cases = [];
        foreach ([false, true] as $legacy) {
            foreach ([59, 60, 61] as $age) {
                $cases[($legacy ? 'legacy' : 'pending').' '.$age] = [$legacy, $age];
            }
        }

        return $cases;
    }

    #[DataProvider('cooldowns')]
    public function test_resend_cooldown_opens_at_exactly_sixty_seconds(bool $legacy, int $age): void
    {
        $owner = $this->owner($legacy);
        $old = $this->seedBearer($owner, $age);
        $before = $owner->refresh()->getAttributes();
        $this->postJson('/api/v1/auth/resend-verification', ['email' => $owner->email, 'captchaToken' => 'fixture'])->assertOk()->assertExactJson(['ok' => true]);
        $this->assertSame($before, $owner->refresh()->getAttributes());
        $this->assertDatabaseCount('email_tokens', 1);
        $this->assertDatabaseCount('mail_outbox', $age >= 60 ? 1 : 0);
        $this->assertDatabaseCount('sessions', 0);
        if ($age >= 60) {
            $this->assertDatabaseMissing('email_tokens', ['id' => $old]);
            Queue::assertPushed(DeliverMailOutboxJob::class, 1);
        } else {
            $this->assertDatabaseHas('email_tokens', ['id' => $old, 'used_at' => null]);
            Queue::assertNothingPushed();
        }
    }

    public static function owners(): array
    {
        return ['pending' => [false], 'legacy' => [true]];
    }

    #[DataProvider('owners')]
    public function test_resend_mail_failure_keeps_the_original_bearer_and_allows_an_immediate_retry(bool $legacy): void
    {
        $owner = $this->owner($legacy);
        $old = $this->seedBearer($owner, 61);
        $before = $owner->refresh()->getAttributes();
        $fail = true;
        DB::listen(static function (QueryExecuted $query) use (&$fail): void {
            if ($fail && str_starts_with(strtolower($query->sql), 'insert into "mail_outbox"')) {
                throw new \RuntimeException('Fixture: resend mail admission failed');
            }
        });
        $payload = ['email' => $owner->email, 'captchaToken' => 'fixture'];
        $this->postJson('/api/v1/auth/resend-verification', $payload)->assertOk()->assertExactJson(['ok' => true]);
        $this->assertSame($before, $owner->refresh()->getAttributes());
        $this->assertDatabaseHas('email_tokens', ['id' => $old, 'used_at' => null]);
        $this->assertDatabaseCount('email_tokens', 1);
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();

        $fail = false;
        $this->postJson('/api/v1/auth/resend-verification', $payload)->assertOk()->assertExactJson(['ok' => true]);
        $this->assertDatabaseMissing('email_tokens', ['id' => $old]);
        $this->assertDatabaseCount('email_tokens', 1);
        $this->assertDatabaseCount('mail_outbox', 1);
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
    }

    public static function terminalOwners(): array
    {
        return ['pending deleted' => [false, 'deleted'], 'legacy deleted' => [true, 'deleted'], 'legacy verified' => [true, 'verified']];
    }

    #[DataProvider('terminalOwners')]
    public function test_resend_rechecks_an_owner_changed_after_the_public_lookup(bool $legacy, string $state): void
    {
        $owner = $this->owner($legacy);
        $this->seedBearer($owner, 61);
        $table = $legacy ? 'users' : 'pending_registrations';
        $intercepted = false;
        DB::listen(static function (QueryExecuted $query) use ($owner, $table, $legacy, $state, &$intercepted): void {
            if (! $intercepted && str_starts_with(strtolower($query->sql), 'select') && str_contains($query->sql, 'from "'.$table.'"') && ! str_contains($query->sql, 'for update')) {
                $intercepted = true;
                if ($legacy) {
                    DB::table('users')->where('id', $owner->id)->update([$state === 'verified' ? 'email_verified_at' : 'deleted_at' => now()]);
                } else {
                    DB::table('pending_registrations')->where('id', $owner->id)->delete();
                }
            }
        });
        $this->postJson('/api/v1/auth/resend-verification', ['email' => 'original@example.test', 'captchaToken' => 'fixture'])->assertOk()->assertExactJson(['ok' => true]);
        $this->assertTrue($intercepted);
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertDatabaseCount('sessions', 0);
        Queue::assertNothingPushed();
    }

    #[DataProvider('owners')]
    public function test_resend_observes_a_cooldown_installed_after_its_public_lookup(bool $legacy): void
    {
        $owner = $this->owner($legacy);
        $old = $this->seedBearer($owner, 61);
        $table = $legacy ? 'users' : 'pending_registrations';
        $current = Ids::sha256Hex(Ids::randomToken(32));
        $intercepted = false;
        DB::listen(static function (QueryExecuted $query) use ($owner, $legacy, $table, $old, $current, &$intercepted): void {
            if (! $intercepted && str_starts_with(strtolower($query->sql), 'select') && str_contains($query->sql, 'from "'.$table.'"') && ! str_contains($query->sql, 'for update')) {
                $intercepted = true;
                DB::table('email_tokens')->where('id', $old)->delete();
                DB::table('email_tokens')->insert(['id' => $current, $legacy ? 'user_id' : 'pending_registration_id' => $owner->id, 'kind' => 'verify', 'expires_at' => now()->addDay(), 'created_at' => now()]);
            }
        });
        $this->postJson('/api/v1/auth/resend-verification', ['email' => 'original@example.test', 'captchaToken' => 'fixture'])->assertOk();
        $this->assertTrue($intercepted);
        $this->assertDatabaseHas('email_tokens', ['id' => $current, 'used_at' => null]);
        $this->assertDatabaseCount('email_tokens', 1);
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();
    }

    public static function destinations(): array
    {
        return ['free' => [false], 'occupied' => [true]];
    }

    #[DataProvider('destinations')]
    public function test_correction_mail_failure_rolls_back_both_free_and_occupied_destinations(bool $occupied): void
    {
        $owner = $this->owner(false);
        $old = $this->seedBearer($owner, 61);
        $before = $owner->refresh()->getAttributes();
        $this->withCookie(RegistrationEdit::cookieName(), RegistrationEdit::secret($owner->id, 1)->getValue());
        if ($occupied) {
            User::factory()->create(['email' => 'destination@example.test']);
        }
        $fail = true;
        DB::listen(static function (QueryExecuted $query) use (&$fail): void {
            if ($fail && str_starts_with(strtolower($query->sql), 'insert into "mail_outbox"')) {
                throw new \RuntimeException('Fixture: correction mail admission failed');
            }
        });
        $payload = ['currentEmail' => 'original@example.test', 'newEmail' => 'destination@example.test', 'captchaToken' => 'fixture'];
        $this->postJson('/api/v1/auth/change-registration-email', $payload)->assertStatus(503);
        $attempt = RegistrationAttempt::sole();
        $this->assertSame(1, $attempt->security_version);
        $this->assertSame('original@example.test', $attempt->email);
        $this->assertNull($attempt->legacy_consumed_at);
        $this->assertSame($before, $owner->refresh()->getAttributes());
        $this->assertDatabaseHas('email_tokens', ['id' => $old, 'used_at' => null]);
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();

        $fail = false;
        $this->postJson('/api/v1/auth/change-registration-email', $payload)->assertOk()->assertExactJson(['ok' => true]);
        $this->assertSame(2, (int) $owner->refresh()->security_version);
        $this->assertSame($occupied ? 'original@example.test' : 'destination@example.test', $owner->email);
        $this->assertDatabaseCount('email_tokens', 1);
        $this->assertDatabaseCount('mail_outbox', 1);
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
    }

    public function test_correction_can_cross_generation_999_without_losing_its_browser_authority(): void
    {
        $owner = $this->owner(false);
        $owner->update(['security_version' => 999]);
        // Begin with an actual old-format cookie, then use the new cookies
        // returned by both corrections: migration must preserve this browser.
        $oldCookie = SealedToken::seal(sprintf('{"e":%013d,"v":2,"pid":"%010d","sv":"%03d"}', (int) (microtime(true) * 1000) + 60_000, $owner->id, 999));
        $this->withCookie(RegistrationEdit::cookieName(), $oldCookie);
        foreach (['first@example.test', 'second@example.test'] as $email) {
            $response = $this->postJson('/api/v1/auth/change-registration-email', ['currentEmail' => $owner->email, 'newEmail' => $email, 'captchaToken' => 'fixture'])->assertOk();
            $cookie = collect($response->headers->getCookies())->first(static fn ($cookie) => $cookie->getName() === RegistrationEdit::cookieName());
            $this->assertNotNull($cookie);
            $this->withCookie(RegistrationEdit::cookieName(), $cookie->getValue());
            $owner->refresh();
        }
        $this->assertSame('second@example.test', $owner->email);
        $this->assertSame(1001, (int) $owner->security_version);
        $this->assertDatabaseCount('email_tokens', 1);
        $this->assertDatabaseCount('sessions', 0);
    }
}
