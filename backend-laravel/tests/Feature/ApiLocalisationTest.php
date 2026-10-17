<?php

namespace Tests\Feature;

use App\Support\ResponseLanguage;
use App\Support\UrlUtil;
use Tests\TestCase;

final class ApiLocalisationTest extends TestCase
{
    public function test_error_code_is_stable_across_languages_and_legacy_clients_remain_spanish(): void
    {
        config(['uvh.localisation_enabled' => true]);
        $english = $this->withHeader('Accept-Language', 'en-GB')->getJson('/api/v1/links')
            ->assertUnauthorized()->assertHeader('Content-Language', 'en-GB');
        $spanish = $this->withHeader('Accept-Language', 'es')->getJson('/api/v1/links')
            ->assertUnauthorized()->assertHeader('Content-Language', 'es-ES');
        $this->assertSame('Not signed in', $english->json('error'));
        $this->assertSame('No autenticado', $spanish->json('error'));
        $this->assertSame($spanish->json('errorCode'), $english->json('errorCode'));
        $this->assertNotEmpty($english->json('errorCode'));
        $this->withHeader('Accept-Language', 'fr-FR')->getJson('/api/v1/links')->assertJsonPath('error', 'No autenticado');
    }

    public function test_pure_validation_errors_are_localised_only_at_the_response_boundary(): void
    {
        config(['uvh.localisation_enabled' => true]);
        $invalid = UrlUtil::validateDestination('ftp://example.test/file');
        $this->assertSame('Solo se permiten URLs http/https', $invalid['error']);
        $response = ResponseLanguage::apply(response()->json(['error' => $invalid['error']], 422), 'en');
        $this->assertSame('Only HTTP/HTTPS URLs are allowed', $response->getData(true)['error']);
        $this->assertSame('es', app()->getLocale());
        $this->assertSame('Untouched <user content>', ResponseLanguage::apply(response()->json(['error' => 'Untouched <user content>'], 422), 'en')->getData(true)['error']);
    }

    public function test_catalogues_have_matching_keys_and_no_missing_copy(): void
    {
        foreach (['messages', 'visitor', 'mail', 'notifications', 'display', 'activity'] as $catalogue) {
            $es = trans($catalogue, [], 'es');
            $en = trans($catalogue, [], 'en_GB');
            $this->assertIsArray($es);
            $this->assertIsArray($en);
            $this->assertSame(array_keys($es), array_keys($en));
            foreach ($en as $key => $text) {
                $this->assertIsString($text);
                $this->assertNotSame('', trim($text));
                preg_match_all('/(?<![a-z]):[a-z][a-z0-9_]*/i', $es[$key], $esTokens);
                preg_match_all('/(?<![a-z]):[a-z][a-z0-9_]*/i', $text, $enTokens);
                sort($esTokens[0]);
                sort($enTokens[0]);
                $this->assertSame($esTokens[0], $enTokens[0], $catalogue.'.'.$key);
            }
        }
    }
}
