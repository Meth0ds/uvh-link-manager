<?php

namespace Tests\Feature;

use App\Models\EmailToken;
use App\Models\PendingRegistration;
use App\Models\User;
use App\Support\Ids;
use App\Support\PendingHandoff;
use App\Support\SessionManager;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

final class RegistrationSessionTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, pending_registrations, mail_outbox, audit_events, audit_outbox, link_intent_claims RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'registration-session')->withHeader('X-CSRF-Token', 'registration-session');
        Queue::fake();
    }

    private function cookie($response, string $name): ?string
    {
        foreach ($response->headers->getCookies() as $cookie) {
            if ($cookie->getName() === $name) {
                return $cookie->getValue();
            }
        }

        return null;
    }

    private function pending(bool $hero = false, ?string $expiresAt = null): array
    {
        $intent = null;
        if ($hero) {
            $intent = $this->postJson('/api/v1/link-intents', ['destination' => 'https://example.org/hero'])->assertCreated()->json('intent');
            $park = $this->postJson('/api/v1/pending/link-intent', ['token' => $intent, 'expiresAt' => $expiresAt])->assertCreated();
            $this->withCookie(PendingHandoff::cookieName(PendingHandoff::INTENT), $this->cookie($park, PendingHandoff::cookieName(PendingHandoff::INTENT)));
        }
        $this->postJson('/api/v1/auth/register', ['email' => 'owner@example.test', 'captchaToken' => 'fixture'])->assertCreated();
        $pending = PendingRegistration::where('email', 'owner@example.test')->firstOrFail();
        $token = Ids::randomToken(32);
        EmailToken::create(['id' => Ids::sha256Hex($token), 'pending_registration_id' => $pending->id, 'kind' => 'verify', 'expires_at' => now()->addHour()]);

        return [$pending, ['token' => $token, 'name' => 'Mailbox Owner', 'password' => 'brujula-limonero-zafiro-93', 'acceptTerms' => true, 'termsVersion' => '2026-10-09', 'privacyVersion' => '2026-10-09'], $intent];
    }

    public function test_new_account_gets_a_real_session_and_hero_survives_another_browser(): void
    {
        [$pending, $payload, $intent] = $this->pending(true);
        $ciphertext = DB::table('registration_link_handoffs')->value('encrypted_token');
        $this->assertStringNotContainsString($intent, $ciphertext);
        // Activation arrives without the original browser's parked cookie.
        $this->withCookie(PendingHandoff::cookieName(PendingHandoff::INTENT), '');
        $activation = $this->postJson('/api/v1/auth/verify-email', $payload)->assertOk()
            ->assertJson(['ok' => true, 'newAccount' => true, 'authenticated' => true, 'pendingLink' => true]);
        $userId = $activation->json('user.id');
        $session = $this->cookie($activation, 'uvh_session');
        $parked = $this->cookie($activation, PendingHandoff::cookieName(PendingHandoff::INTENT));
        $this->assertNotNull($session);
        $this->assertNotNull($parked);
        $this->assertDatabaseCount('links', 0);
        $this->assertDatabaseHas('link_intent_claims', ['intent_hash' => Ids::sha256Hex($intent), 'user_id' => $userId]);
        $this->withCookie('uvh_session', $session)->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('user.id', $userId);
        // A subsequent browser can restore the same associated intent too.
        $restored = $this->getJson('/api/v1/pending')->assertOk()->assertJsonPath('linkIntent.pending', true);
        $this->assertNotNull($this->cookie($restored, PendingHandoff::cookieName(PendingHandoff::INTENT)));
        $this->withCookie(PendingHandoff::cookieName(PendingHandoff::INTENT), $parked);
        $this->postJson('/api/v1/link-intents/claim', [])->assertOk()->assertJsonPath('destination', 'https://example.org/hero');
        $this->assertDatabaseCount('links', 0);
        $this->postJson('/api/v1/link-intents/complete', [])->assertOk();
        $this->assertDatabaseCount('registration_link_handoffs', 0);
        $this->withCookie(PendingHandoff::cookieName(PendingHandoff::INTENT), '')->getJson('/api/v1/pending')->assertJsonPath('linkIntent.pending', false);
    }

    public function test_activation_preserves_another_accounts_session(): void
    {
        [, $payload] = $this->pending(true);
        $other = User::factory()->create();
        $session = SessionManager::create($other->id, Request::create('/'), (int) $other->security_version);
        $this->withCookie('uvh_session', $session);
        $response = $this->postJson('/api/v1/auth/verify-email', $payload)->assertOk()
            ->assertJson(['newAccount' => true, 'authenticated' => false, 'user' => null, 'pendingLink' => true]);
        $this->assertNull($this->cookie($response, 'uvh_session'));
        $this->assertDatabaseCount('sessions', 1);
        $this->getJson('/api/v1/auth/me')->assertJsonPath('user.id', $other->id);
        // The original anonymous intent cannot be stolen by this other account.
        $this->postJson('/api/v1/link-intents/claim', [])->assertNotFound();
    }

    public function test_expired_hero_does_not_block_registration_or_extend_its_lifetime(): void
    {
        [, $payload] = $this->pending(true);
        DB::table('registration_link_handoffs')->update(['expires_at' => now()->subSecond()]);
        $this->withCookie(PendingHandoff::cookieName(PendingHandoff::INTENT), '');
        $response = $this->postJson('/api/v1/auth/verify-email', $payload)->assertOk()->assertJson(['authenticated' => true, 'pendingLink' => false]);
        $this->assertNull($this->cookie($response, PendingHandoff::cookieName(PendingHandoff::INTENT)));
    }

    public function test_session_failure_rolls_back_account_and_keeps_the_activation_bearer(): void
    {
        [$pending, $payload] = $this->pending(true);
        DB::listen(static function (QueryExecuted $query): void {
            if (str_starts_with(strtolower($query->sql), 'insert') && str_contains($query->sql, '"sessions"')) {
                throw new \RuntimeException('Fixture: session admission unavailable');
            }
        });
        $this->withCookie(PendingHandoff::cookieName(PendingHandoff::INTENT), '');
        $response = $this->postJson('/api/v1/auth/verify-email', $payload)->assertServerError();
        $this->assertNull($this->cookie($response, 'uvh_session'));
        $this->assertDatabaseCount('users', 0);
        $this->assertDatabaseCount('workspaces', 0);
        $this->assertDatabaseCount('sessions', 0);
        $this->assertDatabaseCount('link_intent_claims', 0);
        $this->assertDatabaseHas('pending_registrations', ['id' => $pending->id]);
        $this->assertDatabaseHas('email_tokens', ['id' => Ids::sha256Hex($payload['token']), 'used_at' => null]);
        $this->assertDatabaseHas('registration_link_handoffs', ['pending_registration_id' => $pending->id, 'user_id' => null]);
    }

    public function test_discarded_registration_hero_is_not_restored_on_the_next_visit(): void
    {
        [, $payload] = $this->pending(true);
        $response = $this->postJson('/api/v1/auth/verify-email', $payload)->assertOk();
        $this->withCookie('uvh_session', $this->cookie($response, 'uvh_session'));
        $this->deleteJson('/api/v1/pending/link-intent')->assertOk();
        $this->assertDatabaseCount('registration_link_handoffs', 0);
        $this->withCookie(PendingHandoff::cookieName(PendingHandoff::INTENT), '')->getJson('/api/v1/pending')->assertJsonPath('linkIntent.pending', false);
    }

    public function test_registration_preserves_a_shorter_parked_deadline(): void
    {
        $deadline = now()->addMinutes(5)->startOfSecond();
        [, $payload] = $this->pending(true, $deadline->toIso8601String());
        $this->assertSame($deadline->getTimestamp(), Carbon::parse(DB::table('registration_link_handoffs')->value('expires_at'))->getTimestamp());
        $this->withCookie(PendingHandoff::cookieName(PendingHandoff::INTENT), '');
        $response = $this->postJson('/api/v1/auth/verify-email', $payload)->assertOk();
        foreach ($response->headers->getCookies() as $cookie) {
            if ($cookie->getName() === PendingHandoff::cookieName(PendingHandoff::INTENT)) {
                $this->assertSame($deadline->getTimestamp(), $cookie->getExpiresTime());
            }
        }
    }
}
