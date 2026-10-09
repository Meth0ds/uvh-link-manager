<?php

namespace Tests\Feature;

use App\Models\EmailChangeRequest;
use App\Models\EmailToken;
use App\Models\PendingRegistration;
use App\Models\RegistrationAttempt;
use App\Models\User;
use App\Support\Auth\RegistrationAdmission;
use App\Support\Ids;
use App\Support\RegistrationEdit;
use App\Support\SealedToken;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class RegistrationAttemptPrivacyTest extends TestCase
{
    public function test_anonymous_signup_receipts_do_not_reveal_occupancy_via_other_routes(): void
    {
        DB::statement('TRUNCATE users, pending_registrations, mail_outbox, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'enum-probe')->withHeader('X-CSRF-Token', 'enum-probe');
        Queue::fake();
        User::factory()->create(['email' => 'verified@example.test']);
        PendingRegistration::create(['email' => 'foreign-pending@example.test', 'security_version' => 1]);
        $traces = [];
        foreach (['verified', 'foreign-pending', 'free'] as $kind) {
            $email = $kind.'@example.test';
            $registration = $this->postJson('/api/v1/auth/register', ['email' => $email, 'name' => 'Probe Author', 'password' => 'brujula-limonero-zafiro-93', 'acceptTerms' => true, 'termsVersion' => '2026-10-09', 'privacyVersion' => '2026-10-09', 'captchaToken' => 'fixture'])->assertStatus(201)->assertExactJson(['user' => null]);
            $cookie = collect($registration->headers->getCookies())->first(static fn ($cookie) => $cookie->getName() === RegistrationEdit::cookieName());
            $this->assertNotNull($cookie);
            $this->withCookie(RegistrationEdit::cookieName(), $cookie->getValue());
            $login = $this->postJson('/api/v1/auth/login', ['email' => $email, 'password' => 'brujula-limonero-zafiro-93', 'captchaToken' => 'fixture']);
            $correction = $this->postJson('/api/v1/auth/change-registration-email', ['currentEmail' => $email, 'newEmail' => 'next-'.$kind.'@example.test', 'captchaToken' => 'fixture']);
            $traces[$kind] = ['login' => $login->status(), 'reason' => $login->json('reason'), 'correction' => $correction->status()];
        }
        $this->assertSame($traces['verified'], $traces['free'], json_encode($traces, JSON_THROW_ON_ERROR));
        $this->assertSame($traces['foreign-pending'], $traces['free']);
    }

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, pending_registrations, registration_attempts, mail_outbox, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'attempt-privacy')->withHeader('X-CSRF-Token', 'attempt-privacy');
        Queue::fake();
    }

    public static function occupancies(): array
    {
        return array_combine(['free', 'verified', 'unverified', 'deleted', 'pending', 'reserved', 'expired-reservation'], array_map(fn ($state) => [$state], ['free', 'verified', 'unverified', 'deleted', 'pending', 'reserved', 'expired-reservation']));
    }

    private function occupy(string $state, string $email): void
    {
        if (in_array($state, ['verified', 'unverified', 'deleted'], true)) {
            User::factory()->create(['email' => $email, 'email_verified_at' => $state === 'unverified' ? null : now(), 'deleted_at' => $state === 'deleted' ? now() : null]);
        } elseif ($state === 'pending') {
            $pending = PendingRegistration::create(['email' => $email, 'security_version' => 7]);
            EmailToken::create(['id' => Ids::sha256Hex('foreign-bearer'), 'pending_registration_id' => $pending->id, 'kind' => 'verify', 'expires_at' => now()->addDay()]);
        } elseif (in_array($state, ['reserved', 'expired-reservation'], true)) {
            $user = User::factory()->create(['email' => 'reservation-owner@example.test']);
            EmailChangeRequest::create(['user_id' => $user->id, 'new_email' => $email, 'id' => Ids::sha256Hex('reservation'), 'security_version' => 1, 'expires_at' => $state === 'reserved' ? now()->addDay() : now()->subMinute()]);
        }
    }

    private function register(string $email): string
    {
        $response = $this->postJson('/api/v1/auth/register', ['email' => $email, 'name' => 'Context Author', 'password' => 'brujula-limonero-zafiro-93', 'acceptTerms' => true, 'termsVersion' => '2026-10-09', 'privacyVersion' => '2026-10-09', 'captchaToken' => 'fixture'])->assertCreated()->assertExactJson(['user' => null]);

        return $this->receipt($response);
    }

    private function receipt($response): string
    {
        $cookie = collect($response->headers->getCookies())->first(static fn ($cookie) => $cookie->getName() === RegistrationEdit::cookieName());
        $this->assertNotNull($cookie);
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertNull($cookie->getDomain());
        $this->assertSame(strlen((string) RegistrationEdit::decoy()->getValue()), strlen((string) $cookie->getValue()));

        return (string) $cookie->getValue();
    }

    private function hint(string $email): void
    {
        $this->postJson('/api/v1/auth/login', ['email' => $email, 'password' => 'brujula-limonero-zafiro-93', 'captchaToken' => 'fixture'])
            ->assertForbidden()->assertExactJson(['error' => 'Revisa la solicitud de verificación de tu email', 'reason' => 'pending_registration']);
        $this->postJson('/api/v1/auth/resend-verification', ['email' => $email, 'captchaToken' => 'fixture'])->assertOk()->assertExactJson(['ok' => true]);
    }

    private function correct(string $current, string $next)
    {
        return $this->postJson('/api/v1/auth/change-registration-email', ['currentEmail' => $current, 'newEmail' => $next, 'captchaToken' => 'fixture']);
    }

    #[DataProvider('occupancies')]
    public function test_context_owns_only_its_request_and_can_correct_any_initial_outcome(string $state): void
    {
        $email = 'requested@example.test';
        $this->occupy($state, $email);
        $foreignUsers = DB::table('users')->get()->map(static fn ($row) => (array) $row)->all();
        $foreignPending = DB::table('pending_registrations')->get()->map(static fn ($row) => (array) $row)->all();
        $foreignTokens = DB::table('email_tokens')->get()->map(static fn ($row) => (array) $row)->all();
        $receipt = $this->register($email);
        $this->withCookie(RegistrationEdit::cookieName(), $receipt);
        $this->hint($email);
        $next = $this->correct($email, 'corrected@example.test')->assertOk()->assertExactJson(['ok' => true]);
        $newReceipt = $this->receipt($next);
        $this->assertSame($foreignUsers, DB::table('users')->get()->map(static fn ($row) => (array) $row)->all());
        if ($state === 'pending') {
            $this->assertSame($foreignPending, DB::table('pending_registrations')->where('email', $email)->get()->map(static fn ($row) => (array) $row)->all());
            $this->assertSame($foreignTokens, DB::table('email_tokens')->where('id', Ids::sha256Hex('foreign-bearer'))->get()->map(static fn ($row) => (array) $row)->all());
        }
        $this->assertDatabaseHas('pending_registrations', ['email' => 'corrected@example.test']);
        $this->correct($email, 'replay@example.test')->assertForbidden();
        $this->withCookie(RegistrationEdit::cookieName(), $newReceipt);
        $this->hint('corrected@example.test');
        $this->correct($email, 'wrong-binding@example.test')->assertForbidden();
        $this->correct('corrected@example.test', 'final@example.test')->assertOk();
        $this->assertDatabaseCount('sessions', 0);
        $this->assertDatabaseCount('workspaces', 0);
    }

    #[DataProvider('occupancies')]
    public function test_acknowledged_correction_tracks_chosen_email_and_spends_even_conflicting_cookie(string $state): void
    {
        $email = 'occupied@example.test';
        $this->occupy($state, $email);
        $receipt = $this->register('original@example.test');
        $owner = PendingRegistration::where('email', 'original@example.test')->firstOrFail();
        $originalBearer = EmailToken::where('pending_registration_id', $owner->id)->value('id');
        $this->withCookie(RegistrationEdit::cookieName(), $receipt);
        $next = $this->correct('original@example.test', $email)->assertOk();
        $newReceipt = $this->receipt($next);
        $this->assertSame(in_array($state, ['free', 'expired-reservation'], true) ? $email : 'original@example.test', $owner->refresh()->email);
        $this->assertSame(2, (int) $owner->security_version);
        if (! in_array($state, ['free', 'expired-reservation'], true)) {
            $this->assertSame($originalBearer, EmailToken::where('pending_registration_id', $owner->id)->value('id'));
        }
        $this->correct('original@example.test', 'replay@example.test')->assertForbidden();
        $this->withCookie(RegistrationEdit::cookieName(), $newReceipt);
        $this->hint($email);
        $this->correct($email, 'final@example.test')->assertOk();
        $this->assertSame('final@example.test', $owner->refresh()->email);
        $this->assertSame(3, (int) $owner->security_version);
    }

    public function test_activation_does_not_reveal_mailbox_owner_decision_to_browser_context(): void
    {
        $receipt = $this->register('original@example.test');
        $pending = PendingRegistration::sole();
        EmailToken::where('pending_registration_id', $pending->id)->delete();
        $token = Ids::randomToken(32);
        EmailToken::create(['id' => Ids::sha256Hex($token), 'pending_registration_id' => $pending->id, 'kind' => 'verify', 'expires_at' => now()->addDay()]);
        $id = RegistrationAdmission::activate($token, 'mariposa-bronce-fresno-92', 'Mailbox Owner');
        $this->assertIsInt($id);
        $user = User::findOrFail($id)->getAttributes();
        $this->assertNull(RegistrationAttempt::sole()->pending_registration_id);
        $this->withCookie(RegistrationEdit::cookieName(), $receipt);
        $this->hint('original@example.test');
        $this->correct('original@example.test', 'new-request@example.test')->assertOk();
        $this->assertSame($user, User::findOrFail($id)->getAttributes());
        $this->assertDatabaseHas('pending_registrations', ['email' => 'new-request@example.test']);
        $this->assertDatabaseCount('sessions', 0);
    }

    public static function legacyCookies(): array
    {
        return ['v2 real' => [2, true], 'v2 decoy' => [2, false], 'v3 real' => [3, true], 'v3 decoy' => [3, false]];
    }

    #[DataProvider('legacyCookies')]
    public function test_legacy_receipt_upgrades_once_without_revealing_branch(int $version, bool $real): void
    {
        $pending = $real ? PendingRegistration::create(['email' => 'legacy@example.test', 'security_version' => 1]) : null;
        if (! $real) {
            User::factory()->create(['email' => 'legacy@example.test']);
        }
        $format = $version === 2 ? '{"e":%013d,"v":2,"pid":"%010d","sv":"%03d"}' : '{"e":%013d,"v":3,"pid":"%019d","sv":"%010d"}';
        $receipt = SealedToken::seal(sprintf($format, (int) (microtime(true) * 1000) + 60_000, $pending?->id ?? 0, $real ? 1 : 0));
        $this->withCookie(RegistrationEdit::cookieName(), $receipt);
        $this->hint('legacy@example.test');
        $next = $this->correct('legacy@example.test', 'upgraded@example.test')->assertOk();
        $this->correct('legacy@example.test', 'replay@example.test')->assertForbidden();
        $this->withCookie(RegistrationEdit::cookieName(), $this->receipt($next));
        $this->hint('upgraded@example.test');
        $this->correct('upgraded@example.test', 'final@example.test')->assertOk();
        $this->assertDatabaseCount('registration_attempts', 1);
    }

    public function test_v4_never_aliases_the_legacy_pending_id_or_accepts_a_different_deadline(): void
    {
        $receipt = $this->register('original@example.test');
        $attempt = RegistrationAttempt::sole();
        $request = Request::create('/', 'GET', [], [RegistrationEdit::cookieName() => $receipt]);
        $this->assertTrue(RegistrationEdit::authorizesAttempt($request, $attempt));
        $this->assertFalse(RegistrationEdit::authorizes($request, PendingRegistration::sole()));
        foreach ([-1, 1] as $difference) {
            $wrong = SealedToken::seal(sprintf('{"e":%013d,"v":4,"pid":"%019d","sv":"%010d"}', $attempt->expires_at->getTimestampMs() + $difference, $attempt->id, $attempt->security_version));
            $this->withCookie(RegistrationEdit::cookieName(), $wrong);
            $this->correct('original@example.test', 'wrong@example.test')->assertForbidden();
        }
    }

    public function test_missing_tampered_and_expired_receipts_never_bootstrap_context_or_grant_edits(): void
    {
        $expired = SealedToken::seal(sprintf('{"e":%013d,"v":3,"pid":"%019d","sv":"%010d"}', (int) (microtime(true) * 1000) - 1, 0, 0));
        $tampered = 'x'.RegistrationEdit::decoy()->getValue();
        foreach (['', $tampered, $expired] as $receipt) {
            $this->withCookie(RegistrationEdit::cookieName(), $receipt);
            $this->correct('original@example.test', 'new@example.test')->assertForbidden();
            $this->postJson('/api/v1/auth/login', ['email' => 'original@example.test', 'password' => 'brujula-limonero-zafiro-93', 'captchaToken' => 'fixture'])->assertUnauthorized();
        }
        $this->assertDatabaseCount('registration_attempts', 0);
        $this->assertDatabaseCount('pending_registrations', 0);
        $this->assertDatabaseCount('mail_outbox', 0);
    }

    public static function knownPasswords(): array
    {
        return ['verified' => [true], 'unverified' => [false]];
    }

    #[DataProvider('knownPasswords')]
    public function test_correct_account_password_takes_priority_over_registration_context(bool $verified): void
    {
        $user = User::factory()->create(['email' => 'account@example.test', 'email_verified_at' => $verified ? now() : null]);
        $receipt = $this->register($user->email);
        $this->withCookie(RegistrationEdit::cookieName(), $receipt);
        $response = $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'correct horse battery staple', 'captchaToken' => 'fixture']);
        if ($verified) {
            $response->assertOk()->assertJsonPath('user.id', $user->id);
            $this->assertDatabaseCount('sessions', 1);
        } else {
            $response->assertForbidden()->assertJsonPath('reason', 'email_verification_required');
            $this->assertDatabaseCount('sessions', 0);
        }
        $this->assertDatabaseCount('pending_registrations', 0);
    }

    public static function legacyVersions(): array
    {
        return ['v2' => [2], 'v3' => [3]];
    }

    #[DataProvider('legacyVersions')]
    public function test_backfilled_cookie_keeps_its_context_when_activation_precedes_first_cookie_use(int $version): void
    {
        $pending = PendingRegistration::create(['email' => 'backfilled@example.test', 'security_version' => 7]);
        $attempt = RegistrationAttempt::create(['email' => $pending->email, 'expires_at' => RegistrationEdit::deadline(), 'pending_registration_id' => $pending->id, 'pending_security_version' => 7, 'legacy_pending_id' => $pending->id, 'legacy_security_version' => 7]);
        $format = $version === 2 ? '{"e":%013d,"v":2,"pid":"%010d","sv":"%03d"}' : '{"e":%013d,"v":3,"pid":"%019d","sv":"%010d"}';
        $receipt = SealedToken::seal(sprintf($format, $attempt->expires_at->getTimestampMs(), $pending->id, 7));
        $token = Ids::randomToken(32);
        EmailToken::create(['id' => Ids::sha256Hex($token), 'pending_registration_id' => $pending->id, 'kind' => 'verify', 'expires_at' => now()->addDay()]);
        $this->assertIsInt(RegistrationAdmission::activate($token, 'mariposa-bronce-fresno-92', 'Mailbox Owner'));
        $this->assertNull($attempt->refresh()->pending_registration_id);
        $this->withCookie(RegistrationEdit::cookieName(), $receipt);
        $this->hint('backfilled@example.test');
        $this->correct('backfilled@example.test', 'new-request@example.test')->assertOk();
        $this->correct('backfilled@example.test', 'replay@example.test')->assertForbidden();
        $this->assertDatabaseCount('users', 1);
        $this->assertDatabaseCount('registration_attempts', 1);
        $this->assertDatabaseCount('sessions', 0);
    }
}
