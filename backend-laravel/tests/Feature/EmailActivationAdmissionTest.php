<?php

namespace Tests\Feature;

use App\Models\PendingRegistration;
use App\Models\User;
use App\Support\Audit;
use App\Support\Ids;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
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
}
