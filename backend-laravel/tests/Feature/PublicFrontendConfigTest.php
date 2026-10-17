<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

final class PublicFrontendConfigTest extends TestCase
{
    public function test_only_explicit_public_fields_are_exported(): void
    {
        config([
            'uvh.public_origin' => 'https://uvh.test',
            'uvh.frontend_url' => 'https://app.uvh.test',
            'uvh.legal' => [
                'name' => 'Prestador de prueba', 'tax_id' => 'TEST',
                'address' => 'Domicilio de prueba, España', 'registry_status' => 'not_registered',
                'hosting_provider' => 'Proveedor de prueba', 'hosting_region' => 'Unión Europea',
                'private_key' => 'never-publish-this',
            ],
        ]);
        $this->assertSame(0, Artisan::call('uvh:frontend-public-config'));
        $output = Artisan::output();
        $data = json_decode($output, true, 32, JSON_THROW_ON_ERROR);
        $this->assertSame(['publicOrigin', 'appOrigin', 'legalIdentity'], array_keys($data));
        $this->assertSame('https://app.uvh.test', $data['appOrigin']);
        $this->assertStringNotContainsString('never-publish-this', $output);
        $this->assertArrayNotHasKey('private_key', $data['legalIdentity']);
    }

    public function test_incomplete_identity_requires_an_explicit_local_preview_option(): void
    {
        config(['uvh.public_origin' => 'https://uvh.test', 'uvh.frontend_url' => 'https://app.uvh.test', 'uvh.legal' => []]);
        $this->assertSame(1, Artisan::call('uvh:frontend-public-config'));
        $this->assertSame(0, Artisan::call('uvh:frontend-public-config', ['--allow-incomplete' => true]));
        $this->assertNull(json_decode(Artisan::output(), true, 32, JSON_THROW_ON_ERROR)['legalIdentity']);
        $this->app->detectEnvironment(fn () => 'production');
        $this->assertSame(1, Artisan::call('uvh:frontend-public-config', ['--allow-incomplete' => true]));
    }

    public function test_origins_cannot_publish_credentials_paths_or_untrusted_schemes(): void
    {
        config(['uvh.legal' => [], 'uvh.frontend_url' => 'https://app.uvh.test']);
        foreach (['https://user:password@uvh.test', 'https://uvh.test/path', 'https://uvh.test?key=private', 'https://uvh.test#token', 'javascript:alert(1)'] as $origin) {
            config(['uvh.public_origin' => $origin]);
            $this->assertSame(1, Artisan::call('uvh:frontend-public-config', ['--allow-incomplete' => true]));
            $this->assertStringNotContainsString('publicOrigin', Artisan::output());
        }
    }
}
