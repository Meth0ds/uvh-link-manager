<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Ids;
use App\Support\UvhCrypto;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * BAF-051: the user agent is attacker controlled and lands in
 * `sessions.user_agent` (`varchar(255)`) through `SessionManager::create`.
 * No shape of header may fail that INSERT — an oversized or malformed
 * `User-Agent` must never turn a verified login into a `500`. Prepared
 * regression contracts: run only with the isolated *_test DB guard.
 */
final class SessionUserAgentTest extends TestCase
{
    private const CSRF = 'ua-csrf-token';

    private const PASSWORD = 'tiovivo-cobrizo-astilla-42';

    private const SECRET = 'JBSWY3DPEHPK3PXP';

    private const RECOVERY_CODE = 'ABCD2345EFGH6789';

    protected function setUp(): void
    {
        parent::setUp(); // Refuses non-*_test databases before fixture writes.
        DB::statement('TRUNCATE users, sessions, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', self::CSRF)->withHeaders(['X-CSRF-Token' => self::CSRF]);
    }

    public function test_login_truncates_an_oversized_user_agent_instead_of_failing_the_insert(): void
    {
        $user = $this->verifiedUser();
        $oversized = $this->oversizedUserAgent();

        $login = $this->withHeader('User-Agent', $oversized)->postJson('/api/v1/auth/login', [
            'email' => $user->email,
            'password' => self::PASSWORD,
            'captchaToken' => 'test-login-passcode',
        ]);
        $login->assertOk();

        // Truncated, not rewritten: the stored value is a UTF-8-safe prefix
        // that fits the column bound whatever the column counts.
        $stored = $this->storedUserAgent($login);
        $this->assertNotNull($stored);
        $this->assertStringStartsWith($stored, $oversized);
        $this->assertNotSame($oversized, $stored);
        $this->assertTrue(mb_check_encoding($stored, 'UTF-8'));
        $this->assertLessThanOrEqual(255, strlen($stored));
        $this->assertLessThanOrEqual(255, mb_strlen($stored, 'UTF-8'));
        $this->assertGreaterThan(200, strlen($stored), 'the column is filled near its bound, not gutted');
    }

    public function test_both_mfa_completion_flows_accept_oversized_user_agents(): void
    {
        $oversized = $this->oversizedUserAgent();
        foreach (['totp' => '/api/v1/auth/mfa/verify', 'recovery' => '/api/v1/auth/mfa/recovery'] as $method => $route) {
            $user = $this->mfaUser($method);
            $login = $this->postJson('/api/v1/auth/login', [
                'email' => $user->email,
                'password' => self::PASSWORD,
                'captchaToken' => 'test-login-passcode',
            ])->assertOk()->assertJsonPath('mfaRequired', true);

            $done = $this->withHeader('User-Agent', $oversized)->postJson($route, [
                'challenge' => (string) $login->json('challenge'),
                'code' => $method === 'totp' ? $this->totpCode(self::SECRET) : self::RECOVERY_CODE,
            ]);
            $done->assertOk();

            $stored = $this->storedUserAgent($done);
            $this->assertNotNull($stored, $method);
            $this->assertStringStartsWith($stored, $oversized, $method);
            $this->assertTrue(mb_check_encoding($stored, 'UTF-8'), $method);
            $this->assertLessThanOrEqual(255, strlen($stored), $method);
            $this->assertLessThanOrEqual(255, mb_strlen($stored, 'UTF-8'), $method);
        }
    }

    public function test_a_user_agent_that_is_not_valid_utf8_still_creates_the_session(): void
    {
        $user = $this->verifiedUser();
        // Bytes a hostile client can really send: invalid UTF-8 sequences and
        // a NUL, both of which PostgreSQL refuses inside a text column.
        $malformed = "Mozilla/5.0 \xFF\xFE broken\x00 tail";

        $login = $this->withHeader('User-Agent', $malformed)->postJson('/api/v1/auth/login', [
            'email' => $user->email,
            'password' => self::PASSWORD,
            'captchaToken' => 'test-login-passcode',
        ]);
        $login->assertOk();

        $stored = $this->storedUserAgent($login);
        $this->assertNotNull($stored);
        $this->assertTrue(mb_check_encoding($stored, 'UTF-8'));
        $this->assertDoesNotMatchRegularExpression('/[\x00-\x1F\x7F]/', $stored);
        $this->assertStringContainsString('broken', $stored);
        $this->assertStringContainsString('tail', $stored);
    }

    public function test_a_user_agent_with_nothing_persistable_stores_no_user_agent_at_all(): void
    {
        $user = $this->verifiedUser();

        $login = $this->withHeader('User-Agent', "\x00\x01\x07")->postJson('/api/v1/auth/login', [
            'email' => $user->email,
            'password' => self::PASSWORD,
            'captchaToken' => 'test-login-passcode',
        ]);
        $login->assertOk();

        $this->assertNull($this->storedUserAgent($login));
    }

    private function verifiedUser(): User
    {
        return User::factory()->create([
            'name' => 'UA Person', 'email' => 'ua-person@example.test',
            'password_hash' => Hash::make(self::PASSWORD),
        ]);
    }

    private function mfaUser(string $method): User
    {
        return User::factory()->create([
            'name' => 'UA Person', 'email' => 'ua-'.$method.'@example.test',
            'password_hash' => Hash::make(self::PASSWORD),
            'mfa_enabled' => true,
            'mfa_secret' => UvhCrypto::encryptAtRest(self::SECRET),
            'recovery_codes' => [Ids::sha256Hex(self::RECOVERY_CODE)],
        ]);
    }

    /** Multibyte from the first byte so the cut must land on a char boundary. */
    private function oversizedUserAgent(): string
    {
        return str_repeat('á', 300).' Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36';
    }

    private function storedUserAgent($response): ?string
    {
        $token = $this->cookieFrom($response, 'uvh_session');
        $this->assertNotNull($token);
        $value = DB::table('sessions')->where('id', Ids::sha256Hex((string) $token))->value('user_agent');

        return $value === null ? null : (string) $value;
    }

    private function cookieFrom($response, string $name): ?string
    {
        foreach ($response->headers->getCookies() as $cookie) {
            if ($cookie->getName() === $name) {
                return $cookie->getValue();
            }
        }

        return null;
    }

    private function totpCode(string $secret): string
    {
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        $buffer = 0;
        $bits = 0;
        $key = '';
        foreach (str_split($secret) as $character) {
            $buffer = ($buffer << 5) | strpos($alphabet, $character);
            $bits += 5;
            if ($bits >= 8) {
                $bits -= 8;
                $key .= chr(($buffer >> $bits) & 0xFF);
            }
        }
        $counter = intdiv(time(), 30);
        $hash = hash_hmac('sha1', pack('N', 0).pack('N', $counter), $key, true);
        $offset = ord($hash[strlen($hash) - 1]) & 0x0F;
        $binary = ((ord($hash[$offset]) & 0x7F) << 24)
            | (ord($hash[$offset + 1]) << 16)
            | (ord($hash[$offset + 2]) << 8)
            | ord($hash[$offset + 3]);

        return str_pad((string) ($binary % 1_000_000), 6, '0', STR_PAD_LEFT);
    }
}
