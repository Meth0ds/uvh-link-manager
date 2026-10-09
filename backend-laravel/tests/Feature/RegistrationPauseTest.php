<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\RegistrationEdit;
use App\Support\RegistrationGate;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

final class RegistrationPauseTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, pending_registrations, registration_attempts, mail_outbox, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        DB::table('operational_settings')->where('key', RegistrationGate::KEY)->delete();
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'registration-pause')->withHeader('X-CSRF-Token', 'registration-pause');
        Queue::fake();
    }

    private function payload(string $email): array
    {
        return [
            'email' => $email,
            'name' => 'Pause Probe',
            'password' => 'brujula-limonero-zafiro-93',
            'acceptTerms' => true,
            'termsVersion' => '2026-10-09',
            'privacyVersion' => '2026-10-09',
            'captchaToken' => 'fixture',
        ];
    }

    private function editCookie($response): ?string
    {
        $cookie = collect($response->headers->getCookies())
            ->first(static fn ($cookie) => $cookie->getName() === RegistrationEdit::cookieName());

        return $cookie?->getValue();
    }

    public function test_paused_register_returns_503_without_side_effects_and_hides_occupancy(): void
    {
        RegistrationGate::setPaused(true, null, null);
        User::factory()->create(['email' => 'occupied@example.test']);

        foreach (['free@example.test', 'occupied@example.test'] as $email) {
            $response = $this->postJson('/api/v1/auth/register', $this->payload($email))
                ->assertStatus(503)
                ->assertExactJson([
                    'error' => 'Registros temporalmente pausados. Inténtalo de nuevo más tarde.',
                    'reason' => 'registration_paused',
                ]);
            $this->assertNull($this->editCookie($response));
        }

        $this->assertDatabaseCount('registration_attempts', 0);
        $this->assertDatabaseCount('pending_registrations', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
    }

    public function test_open_register_still_creates_attempt_with_cookie(): void
    {
        RegistrationGate::setPaused(false, null, null);

        $response = $this->postJson('/api/v1/auth/register', $this->payload('fresh@example.test'))
            ->assertCreated()
            ->assertExactJson(['user' => null]);
        $this->assertNotNull($this->editCookie($response));
        $this->assertDatabaseCount('registration_attempts', 1);
    }

    public function test_resend_still_answers_while_paused(): void
    {
        RegistrationGate::setPaused(true, null, null);

        $this->postJson('/api/v1/auth/resend-verification', ['email' => 'unknown@example.test', 'captchaToken' => 'fixture'])
            ->assertOk()
            ->assertExactJson(['ok' => true]);
    }
}
