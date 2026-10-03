<?php

namespace Tests\Feature;

use App\Models\PendingRegistration;
use App\Models\RegistrationAttempt;
use App\Models\User;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\RegistrationEdit;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class RegistrationAdmissionTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, pending_registrations, mail_outbox, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'registration-admission')->withHeaders(['X-CSRF-Token' => 'registration-admission']);
        Queue::fake();
    }

    public static function cases(): array
    {
        $cases = [];
        foreach (['register' => ['auth.register', 'auth.terms_accepted', 'auth.privacy_notice_acknowledged'], 'duplicate' => ['auth.register_duplicate'], 'change' => ['auth.registration_email_change'], 'conflict' => ['auth.registration_email_change_conflict']] as $operation => $events) {
            foreach ($events as $event) {
                foreach ([true, false] as $fail) {
                    $cases[$operation.' '.$event.($fail ? ' admission' : ' history')] = [$operation, $event, $fail];
                }
            }
        }

        return $cases;
    }

    private function fixture(string $operation): array
    {
        if ($operation === 'duplicate' || $operation === 'conflict') {
            User::factory()->create(['email' => 'destination@example.test']);
        }
        if ($operation === 'change' || $operation === 'conflict') {
            $pending = PendingRegistration::create(['email' => 'original@example.test', 'security_version' => 1]);
            DB::table('email_tokens')->insert(['id' => Ids::sha256Hex('original-bearer'), 'pending_registration_id' => $pending->id, 'kind' => 'verify', 'expires_at' => now()->addDay(), 'created_at' => now()]);
            $this->withCookie(RegistrationEdit::cookieName(), RegistrationEdit::secret($pending->id, 1)->getValue());

            return ['/api/v1/auth/change-registration-email', ['currentEmail' => $pending->email, 'newEmail' => 'destination@example.test', 'captchaToken' => 'fixture'], $pending];
        }

        return ['/api/v1/auth/register', ['email' => 'destination@example.test', 'name' => 'Example Owner', 'password' => 'brujula-limonero-zafiro-93', 'acceptTerms' => true, 'termsVersion' => '2026-08-30', 'privacyVersion' => '2026-08-30', 'captchaToken' => 'fixture'], null];
    }

    #[DataProvider('cases')]
    public function test_registration_and_exact_event_share_admission(string $operation, string $event, bool $fail): void
    {
        [$route, $payload, $pending] = $this->fixture($operation);
        $before = $pending?->refresh()->getAttributes();
        if ($fail) {
            DB::listen(static function (QueryExecuted $query) use ($event): void {
                if (str_starts_with(strtolower($query->sql), 'insert') && str_contains($query->sql, '"audit_outbox"')) {
                    foreach ($query->bindings as $binding) {
                        if (is_string($binding) && str_contains($binding, '"action":"'.$event.'"')) {
                            throw new \RuntimeException('Fixture: registration audit admission unavailable');
                        }
                    }
                }
            });
        } else {
            Schema::rename('audit_events', 'audit_events_unavailable');
        }
        try {
            $response = $this->postJson($route, $payload);
            if ($fail) {
                $response->assertServerError();
                if ($pending) {
                    $this->assertSame($before, $pending->refresh()->getAttributes());
                    $this->assertDatabaseHas('email_tokens', ['id' => Ids::sha256Hex('original-bearer')]);
                    $attempt = RegistrationAttempt::sole();
                    $this->assertSame(1, $attempt->security_version);
                    $this->assertSame('original@example.test', $attempt->email);
                    $this->assertNull($attempt->legacy_consumed_at);
                } else {
                    $this->assertDatabaseCount('pending_registrations', 0);
                    $this->assertDatabaseCount('registration_attempts', 0);
                }
                $this->assertDatabaseCount('mail_outbox', 0);
                $this->assertDatabaseCount('audit_outbox', 0);
            } else {
                $response->assertStatus($pending ? 200 : 201);
                $this->assertNotNull(collect($response->headers->getCookies())->first(static fn ($cookie) => $cookie->getName() === RegistrationEdit::cookieName()));
                $this->assertDatabaseCount('mail_outbox', 1);
                $events = DB::table('audit_outbox')->get()->map(static fn ($row) => json_decode($row->event, true, flags: JSON_THROW_ON_ERROR));
                $exact = $events->where('action', $event)->values();
                $this->assertCount(1, $exact);
                $this->assertNull($exact[0]['user_id']);
                $this->assertStringNotContainsString('brujula-limonero-zafiro-93', json_encode($exact[0], JSON_THROW_ON_ERROR));
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

    public static function publicOperations(): array
    {
        return ['register' => ['register'], 'change' => ['change']];
    }

    #[DataProvider('publicOperations')]
    public function test_audit_outage_returns_the_same_answer_for_free_and_occupied_destinations(string $operation): void
    {
        // Compare the public production error contract, not local debug traces.
        config(['app.debug' => false]);
        [$route, $payload, $pending] = $this->fixture($operation);
        DB::listen(static function (QueryExecuted $query): void {
            if (str_starts_with(strtolower($query->sql), 'insert') && str_contains($query->sql, '"audit_outbox"')) {
                foreach ($query->bindings as $binding) {
                    if (is_string($binding) && str_contains($binding, '"action":"auth.register')
                        || is_string($binding) && str_contains($binding, '"action":"auth.registration_email_change')) {
                        throw new \RuntimeException('Fixture: registration audit store unavailable');
                    }
                }
            }
        });
        $free = $this->postJson($route, $payload)->assertServerError();
        User::factory()->create(['email' => 'destination@example.test']);
        $occupied = $this->postJson($route, $payload)->assertServerError();
        $this->assertSame($free->json(), $occupied->json());
        foreach ([$free, $occupied] as $answer) {
            $cookie = collect($answer->headers->getCookies())->first(static fn ($cookie) => $cookie->getName() === RegistrationEdit::cookieName());
            $this->assertNull($cookie);
        }
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertDatabaseCount('pending_registrations', $pending ? 1 : 0);
        if ($pending) {
            $this->assertSame('original@example.test', $pending->refresh()->email);
            $this->assertSame(1, (int) $pending->security_version);
        }
    }
}
