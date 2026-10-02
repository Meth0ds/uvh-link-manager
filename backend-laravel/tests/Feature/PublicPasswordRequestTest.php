<?php

namespace Tests\Feature;

use App\Jobs\DeliverMailOutboxJob;
use App\Models\EmailToken;
use App\Models\User;
use App\Support\Ids;
use App\Support\MailDeliveryEligibility;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

final class PublicPasswordRequestTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, email_tokens, mail_outbox RESTART IDENTITY CASCADE');
        Queue::fake();
        config(['uvh.password_reset_min_duration_ms' => 150]);
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'request-fixture')->withHeader('X-CSRF-Token', 'request-fixture');
    }

    public function test_unknown_account_response_obeys_the_same_uniform_floor_as_eligible_accounts(): void
    {
        config(['uvh.password_reset_min_duration_ms' => 150]);
        $started = hrtime(true);
        $this->postJson('/api/v1/auth/forgot-password', ['email' => 'missing@example.test', 'captchaToken' => 'fixture-captcha'])
            ->assertOk()->assertExactJson(['ok' => true]);
        $this->assertGreaterThanOrEqual(140.0, (hrtime(true) - $started) / 1e6);
        $this->assertDatabaseCount('email_tokens', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();
    }

    public function test_unverified_accounts_do_not_admit_undeliverable_reset_mail_or_reset_credentials(): void
    {
        $user = User::factory()->create(['email_verified_at' => null]);
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email, 'captchaToken' => 'fixture-captcha'])
            ->assertOk()->assertExactJson(['ok' => true]);
        $this->assertDatabaseCount('email_tokens', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();
    }

    public function test_a_legacy_reset_bearer_cannot_replace_an_unverified_account_credential(): void
    {
        $user = User::factory()->create(['email_verified_at' => null]);
        $token = Ids::randomToken(32);
        EmailToken::create(['id' => Ids::sha256Hex($token), 'user_id' => $user->id, 'kind' => 'reset', 'expires_at' => now()->addHour()]);
        $before = $user->refresh()->getRawOriginal();
        $this->postJson('/api/v1/auth/reset-password', ['token' => $token, 'password' => 'brujula-limonero-zafiro-93'])->assertStatus(400);
        $this->assertSame($before, $user->refresh()->getRawOriginal());
        $this->assertNull(EmailToken::findOrFail(Ids::sha256Hex($token))->used_at);
        $this->assertDatabaseCount('mail_outbox', 0);
    }

    public function test_eligible_send_and_cooldown_preserve_one_deliverable_request_and_uniform_floor(): void
    {
        $user = User::factory()->create();
        foreach (['send', 'cooldown'] as $branch) {
            $started = hrtime(true);
            $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email, 'captchaToken' => 'fixture-captcha'])
                ->assertOk()->assertExactJson(['ok' => true]);
            $this->assertGreaterThanOrEqual(140.0, (hrtime(true) - $started) / 1e6, $branch);
            $this->assertDatabaseCount('email_tokens', 1);
            $this->assertDatabaseCount('mail_outbox', 1);
        }
        $this->assertTrue(MailDeliveryEligibility::isCurrent(DB::table('mail_outbox')->first()));
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
    }

    public function test_deleted_account_uses_the_generic_floor_without_reset_authority(): void
    {
        $user = User::factory()->create(['deleted_at' => now()]);
        $started = hrtime(true);
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email, 'captchaToken' => 'fixture-captcha'])
            ->assertOk()->assertExactJson(['ok' => true]);
        $this->assertGreaterThanOrEqual(140.0, (hrtime(true) - $started) / 1e6);
        $this->assertDatabaseCount('email_tokens', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();
    }

    public function test_mail_admission_failure_keeps_the_previous_bearer_and_uniform_floor_then_allows_retry(): void
    {
        $user = User::factory()->create();
        $hash = Ids::sha256Hex(Ids::randomToken(32));
        EmailToken::create(['id' => $hash, 'user_id' => $user->id, 'kind' => 'reset', 'expires_at' => now()->addHour()]);
        DB::table('email_tokens')->where('id', $hash)->update(['created_at' => now()->subMinutes(2)]);
        $failAdmission = true;
        $admissionAttempted = false;
        DB::listen(static function (QueryExecuted $query) use (&$failAdmission, &$admissionAttempted): void {
            if ($failAdmission && str_starts_with(strtolower($query->sql), 'insert into "mail_outbox"')) {
                $admissionAttempted = true;
                throw new \RuntimeException('Fixture: reset mail admission failed');
            }
        });
        $started = hrtime(true);
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email, 'captchaToken' => 'fixture-captcha'])
            ->assertOk()->assertExactJson(['ok' => true]);
        $this->assertGreaterThanOrEqual(140.0, (hrtime(true) - $started) / 1e6);
        $this->assertDatabaseCount('email_tokens', 1);
        $this->assertTrue($admissionAttempted);
        $this->assertNull(EmailToken::findOrFail($hash)->used_at);
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();
        $failAdmission = false;
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email, 'captchaToken' => 'fixture-captcha'])
            ->assertOk()->assertExactJson(['ok' => true]);
        $this->assertDatabaseMissing('email_tokens', ['id' => $hash]);
        $this->assertDatabaseCount('email_tokens', 1);
        $this->assertDatabaseCount('mail_outbox', 1);
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
    }
}
