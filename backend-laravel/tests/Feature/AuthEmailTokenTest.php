<?php

namespace Tests\Feature;

use App\Jobs\DeliverMailOutboxJob;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class AuthEmailTokenTest extends TestCase
{
    private const CSRF = 'email-token-csrf';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, email_tokens, mail_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', self::CSRF)->withHeaders(['X-CSRF-Token' => self::CSRF]);
        Queue::fake();
    }

    public function test_verification_resend_replaces_old_bearer_and_enforces_account_cooldown(): void
    {
        $user = User::factory()->create(['email' => 'verify-cooldown@example.test', 'email_verified_at' => null]);
        DB::table('email_tokens')->insert([
            'id' => str_repeat('a', 64),
            'user_id' => $user->id,
            'kind' => 'verify',
            'expires_at' => now()->addDay(),
            'created_at' => now()->subSeconds(61),
        ]);

        $this->postJson('/api/v1/auth/resend-verification', ['email' => $user->email])
            ->assertOk()->assertExactJson(['ok' => true]);
        $currentId = DB::table('email_tokens')->where('user_id', $user->id)->where('kind', 'verify')->value('id');
        $this->assertNotSame(str_repeat('a', 64), $currentId);
        $this->assertDatabaseCount('email_tokens', 1);

        $this->postJson('/api/v1/auth/resend-verification', ['email' => $user->email])
            ->assertOk()->assertExactJson(['ok' => true]);
        $this->assertSame($currentId, DB::table('email_tokens')->where('user_id', $user->id)->value('id'));
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
    }

    public function test_password_reset_email_has_an_account_level_cooldown(): void
    {
        $user = User::factory()->create(['email' => 'reset-cooldown@example.test', 'email_verified_at' => now()]);

        $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email])
            ->assertOk()->assertExactJson(['ok' => true]);
        $firstId = DB::table('email_tokens')->where('user_id', $user->id)->where('kind', 'reset')->value('id');
        $this->assertIsString($firstId);

        $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email])
            ->assertOk()->assertExactJson(['ok' => true]);
        $this->assertSame($firstId, DB::table('email_tokens')->where('user_id', $user->id)->value('id'));
        $this->assertDatabaseCount('email_tokens', 1);
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
    }
}
