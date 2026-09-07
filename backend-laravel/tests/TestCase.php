<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $database = (string) DB::connection()->getDatabaseName();
        if (! str_ends_with($database, '_test')) {
            throw new \RuntimeException("Refusing to run destructive tests against non-test database [{$database}]. Set DB_DATABASE to a dedicated *_test database.");
        }

        // IDs and client IPs are intentionally reused by isolated fixtures.
        // Clear limiter state only after the database-name guard so one test
        // class cannot make an unrelated later class fail with a stray 429.
        Cache::flush();

        // These counters intentionally have no account FK: cascading user
        // fixtures cannot reset them. Isolate tests only AFTER the DB-name guard.
        // The complete test schema, including migration 000032, is required.
        DB::statement('TRUNCATE invitation_mail_budgets');

        // El `environment:` del Compose local pisa las variables del contenedor
        // ANTES de que PHPUnit pueda aplicarlas, y env() prioriza $_ENV (que
        // Dotenv puebla desde .env al arrancar el framework). Forzar el driver
        // síncrono en memoria hace que los jobs se ejecuten inline en tests.
        config(['queue.default' => 'sync']);
        config([
            'uvh.app_host' => 'app.uvh.test',
            'uvh.hcaptcha.site_key' => '10000000-ffff-ffff-ffff-000000000001',
            'uvh.hcaptcha.secret' => '0x0000000000000000000000000000000000000000',
            'uvh.hcaptcha.public_site_key' => '10000000-ffff-ffff-ffff-000000000002',
            'uvh.hcaptcha.public_secret' => '0x0000000000000000000000000000000000000001',
            'uvh.hcaptcha.connect_timeout_seconds' => 2,
            'uvh.hcaptcha.timeout_seconds' => 5,
        ]);
        Http::fake(function ($request) {
            $data = $request->data();
            $public = ($data['sitekey'] ?? null) === config('uvh.hcaptcha.public_site_key');

            return Http::response([
                'success' => true,
                'hostname' => $public ? config('uvh.public_host') : config('uvh.app_host'),
            ]);
        });
    }
}
