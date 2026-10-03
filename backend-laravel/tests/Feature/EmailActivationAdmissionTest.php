<?php

namespace Tests\Feature;

use App\Models\PendingRegistration;
use App\Models\User;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\PasswordStrength;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class EmailActivationAdmissionTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, pending_registrations, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'activation')->withHeaders(['X-CSRF-Token' => 'activation']);
    }

    private function fixture(bool $legacy): array
    {
        $owner = $legacy
            ? User::factory()->create(['email' => 'activation@example.test', 'email_verified_at' => null])
            : PendingRegistration::create(['email' => 'activation@example.test', 'security_version' => 1]);
        $token = Ids::randomToken(32);
        DB::table('email_tokens')->insert(['id' => Ids::sha256Hex($token), $legacy ? 'user_id' : 'pending_registration_id' => $owner->id, 'kind' => 'verify', 'expires_at' => now()->addHour(), 'created_at' => now()]);

        return [$owner, ['token' => $token, 'password' => 'brujula-limonero-zafiro-93', 'name' => 'Mailbox Owner', 'acceptTerms' => true, 'termsVersion' => '2026-08-30', 'privacyVersion' => '2026-08-30']];
    }

    public static function auditCases(): array
    {
        $cases = [];
        foreach ([false, true] as $legacy) {
            foreach (['auth.email_verified', 'auth.terms_accepted', 'auth.privacy_notice_acknowledged'] as $event) {
                foreach ([true, false] as $fail) {
                    $cases[($legacy ? 'legacy' : 'pending').' '.$event.($fail ? ' admission' : ' history')] = [$legacy, $event, $fail];
                }
            }
        }

        return $cases;
    }

    #[DataProvider('auditCases')]
    public function test_activation_and_exact_events_share_one_commit(bool $legacy, string $event, bool $fail): void
    {
        [$owner, $payload] = $this->fixture($legacy);
        $before = $owner->refresh()->getAttributes();
        if ($fail) {
            DB::listen(static function (QueryExecuted $query) use ($event): void {
                if (str_starts_with(strtolower($query->sql), 'insert') && str_contains($query->sql, '"audit_outbox"')) {
                    foreach ($query->bindings as $binding) {
                        if (is_string($binding) && str_contains($binding, '"action":"'.$event.'"')) {
                            throw new \RuntimeException('Fixture: activation audit admission unavailable');
                        }
                    }
                }
            });
        } else {
            Schema::rename('audit_events', 'audit_events_unavailable');
        }
        try {
            $response = $this->postJson('/api/v1/auth/verify-email', $payload);
            if ($fail) {
                $response->assertServerError();
                $this->assertSame($before, $owner->refresh()->getAttributes());
                $this->assertNull(DB::table('email_tokens')->where('id', Ids::sha256Hex($payload['token']))->value('used_at'));
                $this->assertDatabaseCount('users', $legacy ? 1 : 0);
                $this->assertDatabaseCount('workspaces', 0);
                $this->assertDatabaseCount('legal_acceptances', 0);
                $this->assertDatabaseCount('audit_outbox', 0);
            } else {
                $response->assertOk();
                $user = User::where('email', 'activation@example.test')->firstOrFail();
                $this->assertNotNull($user->email_verified_at);
                $events = DB::table('audit_outbox')->get()->map(static fn ($row) => json_decode($row->event, true, flags: JSON_THROW_ON_ERROR));
                $exact = $events->where('action', $event)->values();
                $this->assertCount(1, $exact);
                $this->assertSame($user->id, $exact[0]['user_id']);
                foreach ([$payload['token'], $payload['password']] as $secret) {
                    $this->assertStringNotContainsString($secret, json_encode($exact[0], JSON_THROW_ON_ERROR));
                }
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

    public function test_a_legacy_verification_bearer_cannot_replace_an_already_verified_credential(): void
    {
        [$user, $payload] = $this->fixture(true);
        $user->update(['email_verified_at' => now()]);
        $before = $user->refresh()->getAttributes();
        $this->postJson('/api/v1/auth/verify-email', $payload)->assertStatus(400);
        $this->assertSame($before, $user->refresh()->getAttributes());
        $this->assertNull(DB::table('email_tokens')->where('id', Ids::sha256Hex($payload['token']))->value('used_at'));
        $this->assertDatabaseCount('legal_acceptances', 0);
    }

    public static function accountKinds(): array
    {
        return ['pending' => [false], 'legacy' => [true]];
    }

    #[DataProvider('accountKinds')]
    public function test_activation_establishes_one_identity_without_opening_a_session(bool $legacy): void
    {
        [$owner, $payload] = $this->fixture($legacy);
        if ($legacy) {
            $owner->update(['security_version' => 7]);
        }
        $otherToken = Ids::randomToken(32);
        DB::table('email_tokens')->insert(['id' => Ids::sha256Hex($otherToken), $legacy ? 'user_id' : 'pending_registration_id' => $owner->id, 'kind' => 'verify', 'expires_at' => now()->addHour(), 'created_at' => now()]);

        $response = $this->postJson('/api/v1/auth/verify-email', $payload)->assertOk()->assertExactJson(['ok' => true]);
        $user = User::where('email', 'activation@example.test')->firstOrFail();
        $this->assertSame('Mailbox Owner', $user->name);
        $this->assertTrue(Hash::check($payload['password'], $user->password_hash));
        $this->assertSame($legacy ? 8 : 1, (int) $user->security_version);
        $this->assertNotNull($user->email_verified_at);
        $this->assertDatabaseCount('users', 1);
        $this->assertDatabaseCount('pending_registrations', 0);
        $this->assertDatabaseCount('workspaces', $legacy ? 0 : 1);
        $this->assertDatabaseCount('memberships', $legacy ? 0 : 1);
        $this->assertDatabaseCount('quotas', $legacy ? 0 : 1);
        $this->assertDatabaseCount('legal_acceptances', 2);
        foreach (['terms', 'privacy_notice'] as $type) {
            $this->assertDatabaseHas('legal_acceptances', ['user_id' => $user->id, 'document_type' => $type, 'version' => '2026-08-30', 'source' => 'registration']);
        }
        $this->assertDatabaseCount('sessions', 0);
        $this->assertCount(0, collect($response->headers->getCookies())->filter(static fn ($cookie) => in_array($cookie->getName(), ['uvh_session', 'uvh_mfa_challenge'], true)));
        $this->postJson('/api/v1/auth/verify-email', $payload)->assertStatus(400);
        $this->postJson('/api/v1/auth/verify-email', [...$payload, 'token' => $otherToken])->assertStatus(400);
        $this->assertDatabaseCount('users', 1);
        $this->assertDatabaseCount('legal_acceptances', 2);
    }

    #[DataProvider('accountKinds')]
    public function test_live_mailbox_password_rejection_keeps_the_bearer_for_a_retry(bool $legacy): void
    {
        [$owner, $payload] = $this->fixture($legacy);
        $owner->update(['email' => 'coral-limonero@example.test']);
        $before = $owner->refresh()->getAttributes();
        $password = 'coral-limonero-zafiro-93';
        $this->assertTrue(PasswordStrength::isAcceptable($password));

        $this->postJson('/api/v1/auth/verify-email', [...$payload, 'password' => $password])
            ->assertStatus(422)->assertExactJson(['error' => 'La contraseña es demasiado débil']);
        $this->assertSame($before, $owner->refresh()->getAttributes());
        $this->assertDatabaseHas('email_tokens', ['id' => Ids::sha256Hex($payload['token']), 'used_at' => null]);
        $this->assertDatabaseCount('legal_acceptances', 0);
        $this->assertDatabaseCount('workspaces', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->postJson('/api/v1/auth/verify-email', $payload)->assertOk();
    }
}
