<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\User;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * The credential surfaces (change-email and its cancel, change-password,
 * mfa-disable) share the family's single step-up contract. The defect class
 * pinned here is the one their inline verification lacked:
 *  - freshness window: a parked session cannot spend the factor until it
 *    re-authenticates, and the rejected attempt consumes nothing;
 *  - shared anti-replay: one TOTP code authorizes exactly one operation across
 *    the whole family, even when the operation itself refuses afterwards.
 *
 * Prepared only; *_test guard precedes TRUNCATE, PHPUnit uses an array cache.
 */
final class CredentialStepUpContractTest extends TestCase
{
    private const PASSWORD = 'tiovivo-cobrizo-astilla-42';

    private const NEW_PASSWORD = 'brujula-limonero-zafiro-93';

    /** RFC 6238 fixture key (ASCII "12345678901234567890"). */
    private const TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, email_tokens, mail_outbox, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'credential-stepup-csrf')->withHeader('X-CSRF-Token', 'credential-stepup-csrf');
        Queue::fake();
    }

    public static function surfaces(): array
    {
        return [
            'change-email' => ['change-email'],
            'change-password' => ['change-password'],
            'mfa-disable' => ['mfa-disable'],
        ];
    }

    #[DataProvider('surfaces')]
    public function test_a_parked_session_never_spends_the_factor(string $surface): void
    {
        $user = $this->mfaUser();
        $sessionId = $this->useSession($user);

        // Window is 15 minutes; half an hour ago is a parked session.
        DB::table('sessions')->where('id', $sessionId)
            ->update(['mfa_verified_at' => now()->subMinutes(30)]);
        $code = self::currentCode();

        $this->callSurface($surface, $code)->assertStatus(403)
            ->assertJsonPath('details.reason', 'mfa_reauthentication_required');

        // The window is checked before the factor: the very same code still
        // opens the documented remediation, proving nothing was consumed.
        $this->postJson('/api/v1/auth/mfa/reauthenticate', [
            'password' => self::PASSWORD,
            'factorCode' => $code,
        ])->assertStatus(200);
    }

    #[DataProvider('surfaces')]
    public function test_one_totp_code_authorizes_exactly_one_operation(string $surface): void
    {
        $user = $this->mfaUser(['is_admin' => $surface === 'mfa-disable']);
        $this->useSession($user);
        $code = self::currentCode();

        $first = $this->callSurface($surface, $code, 'first-target@example.test');
        if ($surface === 'mfa-disable') {
            // The operation refuses AFTER the factor was spent: platform
            // administration is MFA-gated and must be retired first.
            $first->assertStatus(409);
            DB::table('users')->where('id', $user->id)->update(['is_admin' => false]);
        } else {
            $first->assertStatus(200);
        }

        // The spent code cannot authorize a second operation anywhere.
        $this->callSurface($surface, $code, 'second-target@example.test')->assertStatus(403);

        if ($surface === 'change-email') {
            $this->assertDatabaseCount('email_change_requests', 1);
        } elseif ($surface === 'change-password') {
            self::assertTrue(Hash::check(self::NEW_PASSWORD, $user->refresh()->password_hash));
        } else {
            self::assertTrue((bool) $user->refresh()->mfa_enabled);
        }
    }

    private function callSurface(string $surface, string $code, string $target = 'next-identity@example.test')
    {
        $payloads = [
            'change-email' => [
                'newEmail' => $target, 'password' => self::PASSWORD, 'factorCode' => $code,
            ],
            'change-password' => [
                'current' => self::PASSWORD, 'newPassword' => self::NEW_PASSWORD, 'factorCode' => $code,
            ],
            'mfa-disable' => [
                'password' => self::PASSWORD, 'code' => $code,
            ],
        ];

        return match ($surface) {
            'change-email' => $this->postJson('/api/v1/auth/change-email', $payloads['change-email']),
            'change-password' => $this->postJson('/api/v1/auth/change-password', $payloads['change-password']),
            'mfa-disable' => $this->postJson('/api/v1/auth/mfa/disable', $payloads['mfa-disable']),
        };
    }

    /** @param array<string, bool> $extra */
    private function mfaUser(array $extra = []): User
    {
        $user = User::factory()->create(array_merge(
            ['password_hash' => Hash::make(self::PASSWORD)],
            $extra,
        ));
        $user->forceFill([
            'email_verified_at' => now(),
            'mfa_enabled' => true,
            'mfa_secret' => UvhCrypto::encryptAtRest(self::TOTP_SECRET),
            'recovery_codes' => null,
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

    private static function currentCode(): string
    {
        // Totp uses wall-clock microtime(), not Carbon's test clock. Generate
        // the RFC fixture's current step without sleeps or changing system time.
        $counter = intdiv(time(), 30);
        $digest = hash_hmac('sha1', pack('N2', 0, $counter), '12345678901234567890', true);
        $offset = ord($digest[19]) & 0x0F;
        $binary = unpack('N', substr($digest, $offset, 4))[1] & 0x7FFFFFFF;

        return str_pad((string) ($binary % 1000000), 6, '0', STR_PAD_LEFT);
    }
}
