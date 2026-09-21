<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Totp;
use App\Support\UvhCrypto;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The development authenticator has to hold two properties at once: the code it
 * prints must be one the real verifier accepts, and it must refuse to print
 * anything outside local/testing. Only the second one is about safety, and it is
 * the one that would rot silently, so both are asserted.
 */
final class DevTotpCommandTest extends TestCase
{
    private const SECRET = 'JBSWY3DPEHPK3PXP';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users RESTART IDENTITY CASCADE');
    }

    public function test_it_prints_a_code_the_verifier_accepts_without_exposing_the_secret(): void
    {
        $user = $this->account(['mfa_enabled' => true, 'mfa_secret' => UvhCrypto::encryptAtRest(self::SECRET)]);

        [$exit, $output] = $this->invoke(['email' => $user->email]);

        $this->assertSame(0, $exit, $output);
        $this->assertTrue(Totp::verify($this->codeFor($output, 'activo'), self::SECRET), $output);
        $this->assertStringNotContainsString(self::SECRET, $output);
        $this->assertStringNotContainsString('otpauth://', $output);
    }

    public function test_it_can_show_the_secret_and_its_enrollment_uri_on_request(): void
    {
        $user = $this->account(['mfa_enabled' => true, 'mfa_secret' => UvhCrypto::encryptAtRest(self::SECRET)]);

        [$exit, $output] = $this->invoke(['email' => $user->email, '--show-secret' => true]);

        $this->assertSame(0, $exit, $output);
        $this->assertStringContainsString(self::SECRET, $output);
        $this->assertStringContainsString('otpauth://totp/', $output);
        $this->assertStringContainsString(rawurlencode($user->email), $output);
    }

    public function test_it_resolves_the_staged_factor_while_an_enrollment_is_pending(): void
    {
        $staged = 'GEZDGNBVGY3TQOJQ';
        $user = $this->account([
            'mfa_pending_secret' => UvhCrypto::encryptAtRest($staged),
            'mfa_pending_expires_at' => now()->addMinutes(10),
        ]);

        [$exit, $output] = $this->invoke(['email' => $user->email]);

        $this->assertSame(0, $exit, $output);
        $this->assertTrue(Totp::verify($this->codeFor($output, 'alta pendiente'), $staged), $output);
        $this->assertStringContainsString('MFA: alta en curso', $output);
    }

    public function test_it_says_an_expired_enrollment_expired_instead_of_printing_its_code(): void
    {
        $user = $this->account([
            'mfa_pending_secret' => UvhCrypto::encryptAtRest('GEZDGNBVGY3TQOJQ'),
            'mfa_pending_expires_at' => now()->subMinute(),
        ]);

        [$exit, $output] = $this->invoke(['email' => $user->email]);

        $this->assertSame(1, $exit, $output);
        $this->assertStringContainsString('El alta pendiente caducó', $output);
        $this->assertStringContainsString('Verificación en dos pasos', $output);
    }

    public function test_it_resolves_a_secret_passed_directly_so_an_enrollment_can_be_confirmed(): void
    {
        [$exit, $output] = $this->invoke(['--secret' => ' jbswy3dpehpk3pxp= ']);

        $this->assertSame(0, $exit, $output);
        $this->assertTrue(Totp::verify($this->codeFor($output, '--secret'), self::SECRET), $output);
    }

    public function test_it_rejects_a_secret_the_verifier_would_refuse(): void
    {
        [$exit, $output] = $this->invoke(['--secret' => 'not-a-base32-secret!']);

        $this->assertSame(1, $exit, $output);
        $this->assertStringContainsString('base32', $output);
    }

    public function test_it_explains_an_account_without_a_factor(): void
    {
        $user = $this->account([]);

        [$exit, $output] = $this->invoke(['email' => $user->email]);

        $this->assertSame(1, $exit, $output);
        $this->assertStringContainsString('no tiene un factor TOTP utilizable', $output);
    }

    public function test_it_rejects_an_unknown_account(): void
    {
        [$exit, $output] = $this->invoke(['email' => 'nobody@example.test']);

        $this->assertSame(1, $exit, $output);
        $this->assertStringContainsString('No existe una cuenta', $output);
    }

    public function test_it_refuses_to_hand_out_a_factor_outside_development(): void
    {
        $user = $this->account(['mfa_enabled' => true, 'mfa_secret' => UvhCrypto::encryptAtRest(self::SECRET)]);
        $environment = $this->app['env'];
        $this->app['env'] = 'production';

        try {
            [$exit, $output] = $this->invoke(['email' => $user->email]);
        } finally {
            $this->app['env'] = $environment;
        }

        $this->assertSame(1, $exit, $output);
        $this->assertStringContainsString('sólo funciona con APP_ENV=local o testing', $output);
        $this->assertDoesNotMatchRegularExpression('/\b\d{6}\b/', $output);
    }

    /** @param array<string, mixed> $attributes */
    private function account(array $attributes): User
    {
        return User::factory()->create(array_merge(['email' => 'operator@example.test'], $attributes));
    }

    /** @param array<string, mixed> $arguments */
    private function invoke(array $arguments): array
    {
        $exit = Artisan::call('uvh:dev:totp', $arguments);

        return [$exit, Artisan::output()];
    }

    private function codeFor(string $output, string $label): string
    {
        $this->assertMatchesRegularExpression('/^'.preg_quote($label, '/').'\s+\d{6}\b/m', $output, $output);
        preg_match('/^'.preg_quote($label, '/').'\s+(\d{6})\b/m', $output, $matches);

        return $matches[1];
    }
}
