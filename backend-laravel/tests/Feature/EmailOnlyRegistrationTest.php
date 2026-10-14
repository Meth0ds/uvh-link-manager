<?php

namespace Tests\Feature;

use App\Models\EmailToken;
use App\Models\PendingRegistration;
use App\Models\User;
use App\Support\Ids;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

final class EmailOnlyRegistrationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, pending_registrations, registration_attempts, mail_outbox, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'email-only')->withHeader('X-CSRF-Token', 'email-only');
        Queue::fake();
    }

    public function test_email_only_request_leaves_identity_and_consent_for_activation(): void
    {
        $this->postJson('/api/v1/auth/register', ['email' => 'Owner@example.test', 'captchaToken' => 'fixture'])
            ->assertCreated()->assertExactJson(['user' => null]);
        $pending = PendingRegistration::where('email', 'owner@example.test')->firstOrFail();
        $this->assertDatabaseCount('users', 0);
        $this->assertDatabaseCount('workspaces', 0);
        $this->assertDatabaseCount('legal_acceptances', 0);
        $this->assertSame(0, DB::table('audit_events')->whereIn('action', ['auth.terms_accepted', 'auth.privacy_notice_acknowledged'])->count());
        foreach (DB::table('audit_outbox')->pluck('event') as $event) {
            $this->assertNotContains(json_decode($event, true)['action'], ['auth.terms_accepted', 'auth.privacy_notice_acknowledged']);
        }
        $this->assertDatabaseCount('mail_outbox', 1);

        $token = Ids::randomToken(32);
        EmailToken::create(['id' => Ids::sha256Hex($token), 'pending_registration_id' => $pending->id, 'kind' => 'verify', 'expires_at' => now()->addHour()]);
        $activation = ['token' => $token, 'name' => 'Mailbox Owner', 'password' => 'brujula-limonero-zafiro-93', 'acceptTerms' => true, 'termsVersion' => '2026-10-09', 'privacyVersion' => '2026-10-09'];

        $this->postJson('/api/v1/auth/verify-email', array_merge($activation, ['acceptTerms' => false]))->assertUnprocessable();
        $this->assertDatabaseCount('users', 0);
        $this->postJson('/api/v1/auth/verify-email', $activation)->assertOk();
        $user = User::where('email', 'owner@example.test')->firstOrFail();
        $this->assertSame('Mailbox Owner', $user->name);
        $this->assertTrue(Hash::check($activation['password'], $user->password_hash));
        $this->assertNotNull($user->email_verified_at);
        $this->assertDatabaseCount('workspaces', 1);
        $this->assertDatabaseCount('legal_acceptances', 2);
        $this->assertDatabaseCount('sessions', 1);
        $this->postJson('/api/v1/auth/verify-email', $activation)->assertBadRequest();
    }

    public function test_email_and_honeypot_are_still_validated_before_sending(): void
    {
        foreach ([['email' => 'invalid'], ['email' => 'owner@example.test', 'website' => 'bot']] as $payload) {
            $this->postJson('/api/v1/auth/register', array_merge($payload, ['captchaToken' => 'fixture']))->assertUnprocessable();
        }
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertDatabaseCount('pending_registrations', 0);
    }

    public function test_duplicate_email_keeps_the_same_public_response(): void
    {
        $payload = ['email' => 'owner@example.test', 'captchaToken' => 'fixture'];
        $this->postJson('/api/v1/auth/register', $payload)->assertCreated()->assertExactJson(['user' => null]);
        $this->postJson('/api/v1/auth/register', $payload)->assertCreated()->assertExactJson(['user' => null]);
        $this->assertDatabaseCount('pending_registrations', 1);
        $this->assertDatabaseCount('users', 0);
    }
}
