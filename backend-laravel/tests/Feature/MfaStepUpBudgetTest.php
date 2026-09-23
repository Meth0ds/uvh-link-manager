<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Support\Ids;
use App\Support\MfaAttempts;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * Step-up hardening contract (security finding #3):
 *  - the verification-attempt budget follows the ACCOUNT, so draining one
 *    session's `uvh-credential` limiter and re-authenticating cannot amplify
 *    into more guesses;
 *  - a step-up requires a fresh privileged window; the remediation is
 *    /mfa/reauthenticate, and a successful step-up refreshes the window.
 *
 * Prepared only; *_test guard precedes TRUNCATE, PHPUnit uses an array cache.
 */
final class MfaStepUpBudgetTest extends TestCase
{
    private const PASSWORD = 'tiovivo-cobrizo-astilla-42';

    /** Well-formed base32 recovery code, never present in any fixture set. */
    private const BAD_CODE = 'ZZZZZZZZ2222YYYY';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, mail_outbox, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'mfa-budget-csrf')->withHeader('X-CSRF-Token', 'mfa-budget-csrf');
        Queue::fake();
    }

    public function test_step_up_budget_follows_the_account_across_sessions(): void
    {
        $codes = ['ABCDEFGH2345678J'];
        $user = $this->mfaUser($codes);

        // Session A spends eight failures; its per-session middleware budget is
        // exhausted at the same boundary, which is exactly why the attacker
        // rotates sessions below.
        $this->useSession($user);
        for ($attempt = 0; $attempt < 8; $attempt++) {
            $this->regenerate(self::BAD_CODE)->assertStatus(403);
        }

        // Session B is a distinct real session: two more failures reach the
        // account-wide cap of 10.
        $this->useSession($user);
        $this->regenerate(self::BAD_CODE)->assertStatus(403);
        $this->regenerate(self::BAD_CODE)->assertStatus(403);

        // Budget spent: even a VALID factor cannot open the surface now.
        $locked = $this->regenerate($codes[0]);
        $locked->assertStatus(429)
            ->assertHeader('Retry-After')
            ->assertJsonPath('error', 'Demasiados intentos. Espera unos minutos.')
            ->assertJsonStructure(['retryAfterSeconds']);
        self::assertGreaterThanOrEqual(1, $locked->json('retryAfterSeconds'));

        // Locked responses never reach factor verification, so the valid
        // recovery credential is not consumed either.
        self::assertCount(1, $user->fresh()->recovery_codes);
    }

    public function test_step_up_window_lapse_is_remediated_by_reauthentication(): void
    {
        $codes = ['KLMNPQRS23456789', 'ZYXWVUTS98765432', 'AAAA2222BBBB3333'];
        $user = $this->mfaUser($codes);
        $sessionId = $this->useSession($user);

        // A parked session: MFA verified half an hour ago, window is 15 min.
        DB::table('sessions')->where('id', $sessionId)
            ->update(['mfa_verified_at' => now()->subMinutes(30)]);
        $this->regenerate($codes[0])->assertStatus(403)
            ->assertJsonPath('details.reason', 'mfa_reauthentication_required');

        // The window is checked before the factor: nothing was consumed.
        self::assertCount(3, $user->fresh()->recovery_codes);

        // The documented remediation refreshes the window without a new login.
        $this->postJson('/api/v1/auth/mfa/reauthenticate', [
            'password' => self::PASSWORD,
            'factorCode' => $codes[1],
        ])->assertStatus(200)->assertJsonStructure(['ok', 'verifiedAt', 'expiresAt']);
        $this->getJson('/api/v1/auth/mfa/session')->assertStatus(200)->assertJsonPath('fresh', true);

        // A mature-but-fresh window still operates, and the successful step-up
        // itself re-anchors mfa_verified_at to now.
        DB::table('sessions')->where('id', $sessionId)
            ->update(['mfa_verified_at' => now()->subMinutes(5)]);
        $this->regenerate($codes[2])->assertStatus(200)->assertJsonStructure(['recoveryCodes']);

        $verifiedAt = DB::table('sessions')->where('id', $sessionId)->value('mfa_verified_at');
        self::assertNotNull($verifiedAt);
        self::assertTrue(
            Carbon::parse($verifiedAt)->gt(now()->subMinute()),
            'A successful step-up must refresh the privileged window',
        );
    }

    /**
     * The parked-session answer must not depend on the password: a stale
     * session that could tell "wrong password" from "lapsed window" would be
     * asking these surfaces "is this the current password?". Every probe below
     * carries a VALID factor and a wrong password, and must meet the same
     * remediation answer — and charge nothing to the account budget.
     */
    public function test_a_parked_session_cannot_ask_is_this_the_password(): void
    {
        $codes = ['QRS2TUV3WXYZ4567', 'JKLMNPQR8ABCDEFG', 'HJKMNPQR2ABCDE34'];
        $user = $this->mfaUser($codes);
        $sessionId = $this->useSession($user);
        DB::table('sessions')->where('id', $sessionId)
            ->update(['mfa_verified_at' => now()->subMinutes(30)]);

        for ($attempt = 0; $attempt < MfaAttempts::LIMIT; $attempt++) {
            $this->regenerate($codes[0], 'la-contraseña-que-no-es')
                ->assertStatus(403)
                ->assertJsonPath('details.reason', 'mfa_reauthentication_required');
        }

        // Not one probe was charged: a fresh session still spends a real
        // step-up. Had they been, the per-purpose cap would answer 429 here.
        $this->useSession($user);
        $this->regenerate($codes[2])->assertStatus(200)->assertJsonStructure(['recoveryCodes']);
    }

    /**
     * Two levels, one account: a spent purpose leaves its siblings their own
     * allowance (the operational isolation), while the account-wide level
     * bounds the total — changing surfaces multiplies no guessing budget.
     */
    public function test_the_attempt_budget_is_shared_across_purposes(): void
    {
        $user = $this->mfaUser(['ABCDEFGH2345678J']);

        foreach (['totp', 'recovery'] as $purpose) {
            for ($attempt = 0; $attempt < MfaAttempts::LIMIT; $attempt++) {
                MfaAttempts::recordFailure($user->id, $purpose);
            }
        }

        // The step-up purpose bucket is pristine, but the account-wide one is
        // spent: the surface refuses before checking anything at all.
        $this->useSession($user);
        $this->regenerate('ABCDEFGH2345678J')->assertStatus(429)
            ->assertHeader('Retry-After')
            ->assertJsonPath('error', 'Demasiados intentos. Espera unos minutos.');
    }

    public function test_a_spent_purpose_leaves_its_siblings_their_own_allowance(): void
    {
        $user = $this->mfaUser(['KLMNPQR23456789A']);

        for ($attempt = 0; $attempt < MfaAttempts::LIMIT; $attempt++) {
            MfaAttempts::recordFailure($user->id, 'totp');
        }

        // Half the account-wide allowance is spent on another surface; this
        // one still operates with its own bucket.
        $this->useSession($user);
        $this->regenerate('KLMNPQR23456789A')->assertStatus(200)->assertJsonStructure(['recoveryCodes']);
    }

    /** @param array<int, string> $recoveryCodes */
    private function mfaUser(array $recoveryCodes): User
    {
        $user = User::factory()->create(['password_hash' => Hash::make(self::PASSWORD)]);
        $user->forceFill([
            'email_verified_at' => now(),
            'mfa_enabled' => true,
            'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP'),
            'recovery_codes' => array_map(fn (string $code) => Ids::sha256Hex($code), $recoveryCodes),
        ])->save();

        return $user->refresh();
    }

    /** A distinct real session row, hydrated exactly like the middleware does. */
    private function useSession(User $user): string
    {
        $token = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, mfaVerified: true);
        $this->withCookie('uvh_session', $token);

        return Ids::sha256Hex($token);
    }

    private function regenerate(string $factorCode, string $password = self::PASSWORD)
    {
        return $this->postJson('/api/v1/auth/mfa/recovery-codes/regenerate', [
            'password' => $password,
            'factorCode' => $factorCode,
        ]);
    }
}
