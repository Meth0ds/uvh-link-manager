<?php

namespace Tests\Unit;

use App\Support\PasswordStrength;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class PasswordStrengthTest extends TestCase
{
    public function test_rejects_below_minimum_length(): void
    {
        $this->assertFalse(PasswordStrength::isAcceptable('Ab1!ab1!a'));
    }

    public function test_rejects_above_bcrypt_limit(): void
    {
        $this->assertFalse(PasswordStrength::isAcceptable(str_repeat('Ab1!', 19)));
    }

    public function test_rejects_empty_password(): void
    {
        $this->assertFalse(PasswordStrength::isAcceptable(''));
    }

    #[DataProvider('commonPasswordProvider')]
    public function test_hard_rejects_weak_classic_passwords(string $password): void
    {
        $this->assertFalse(
            PasswordStrength::isAcceptable($password),
            "'$password' should be rejected server-side",
        );
    }

    public function test_assess_flags_the_expected_weakness_reasons(): void
    {
        $this->assertTrue(PasswordStrength::assess('password-123456')['common']);
        $this->assertTrue(PasswordStrength::assess('Password123!')['common']);
        $this->assertTrue(PasswordStrength::assess('1234abcd5678')['patterned']);
        $this->assertTrue(PasswordStrength::assess('qwertyuiop1')['patterned']);
        $this->assertTrue(PasswordStrength::assess('SuperMan-Rules-99', 'SuperMan')['personal']);
    }

    public static function commonPasswordProvider(): array
    {
        return [
            'plain common' => ['password-123456'],
            'capitalized with symbols' => ['Password123!'],
            'spanish common' => ['contrasena-123'],
            'sequence only' => ['1234abcd5678'],
            'keyboard walk' => ['qwertyuiop1'],
            'contains uvh' => ['uvh-admin-2026'],
        ];
    }

    public function test_rejects_personal_data_from_name(): void
    {
        // Long enough and high char-class variety, but contains the name.
        $this->assertFalse(
            PasswordStrength::isAcceptable('SuperMan-Rules-99', 'SuperMan', 'other@example.com'),
        );
    }

    public function test_rejects_personal_data_from_email_local_part(): void
    {
        $this->assertFalse(
            PasswordStrength::isAcceptable('superman-rules-99', 'Someone Else', 'superman@example.com'),
        );
    }

    public function test_ignores_personal_data_shorter_than_three_chars(): void
    {
        // "Al" is only 2 chars, so it must NOT count as personal data.
        $this->assertTrue(
            PasswordStrength::isAcceptable('Al-owns-this-long-passphrase', 'Al', 'al@example.com'),
        );
    }

    public function test_accepts_a_strong_passphrase(): void
    {
        $this->assertTrue(
            PasswordStrength::isAcceptable('tiovivo-cobrizo-astilla-42', 'Jane Doe', 'jane@example.com'),
        );
    }

    public function test_accepts_long_passphrase_without_symbol_classes(): void
    {
        $this->assertTrue(
            PasswordStrength::isAcceptable('correct horse battery staple'),
        );
    }

    public function test_rejects_repetitive_password(): void
    {
        $this->assertFalse(PasswordStrength::isAcceptable('aaaaaaaaaaaa'));
    }

    public function test_scores_match_frontend_bands(): void
    {
        // Boundaries chosen to match the UI bands: >=82 Fuerte, >=58 Buena,
        // >=30 Mejorable, <30 Débil.
        $strong = PasswordStrength::assess('correct horse battery staple xyz');
        $this->assertGreaterThanOrEqual(82, $strong['score']);

        $weak = PasswordStrength::assess('aaaaaaaaaa');
        $this->assertLessThan(30, $weak['score']);
    }

    public function test_assess_empty_password_returns_zero_score(): void
    {
        $result = PasswordStrength::assess('');

        $this->assertSame(0, $result['score']);
        $this->assertFalse($result['common']);
    }

    public function test_assess_handles_accents_like_the_frontend(): void
    {
        // "contraseña" with an accent should still be flagged common after
        // NFKD + diacritic stripping.
        $result = PasswordStrength::assess('Contraseña-2026!');

        $this->assertTrue($result['common']);
        $this->assertFalse(PasswordStrength::isAcceptable('Contraseña-2026!'));
    }
}
