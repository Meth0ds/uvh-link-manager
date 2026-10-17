<?php

namespace Tests\Unit;

use App\Support\Language;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class LanguageTest extends TestCase
{
    public static function headers(): array
    {
        return [
            [null, 'es'], ['', 'es'], ['fr-FR,de;q=0.8', 'es'], ['en-US,en;q=0.9', 'en'],
            ['fr-FR,en-GB;q=0.9,es;q=0.8', 'en'], ['es-MX,en;q=0.9', 'es'],
            ['es;q=0.2,en;q=0.9', 'en'], ['en;q=0,es;q=0.4', 'es'],
            ['en;q=2,es;q=0.2', 'es'], ['../../en', 'es'], ['en;q=0.9,es;q=0.9', 'en'],
        ];
    }

    #[DataProvider('headers')]
    public function test_negotiation_is_bounded_and_honours_qualities(?string $header, string $expected): void
    {
        $this->assertSame($expected, Language::negotiate($header));
    }

    public function test_only_exact_language_values_are_supported(): void
    {
        foreach (['es', 'en'] as $language) {
            $this->assertTrue(Language::valid($language));
        }
        foreach ([null, [], 'en-GB', 'ES', '../../en', 'es/'] as $language) {
            $this->assertFalse(Language::valid($language));
        }
    }
}
