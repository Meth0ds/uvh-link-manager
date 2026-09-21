<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Env;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\WithEnvironmentVariable;
use ReflectionMethod;

abstract class TestCase extends BaseTestCase
{
    /**
     * The `$_SERVER` value every pinned variable had before `setUp()`, keyed by
     * name, so `tearDown()` can put it back instead of leaking it forward.
     *
     * @var array<string, array{bool, ?string}>
     */
    private array $replacedServerEnvironment = [];

    protected function setUp(): void
    {
        $this->pinDeclaredEnvironmentOverrides();

        parent::setUp();

        $database = (string) DB::connection()->getDatabaseName();
        if (! str_ends_with($database, '_test')) {
            throw new \RuntimeException("Refusing to run destructive tests against non-test database [{$database}]. Set DB_DATABASE to a dedicated *_test database.");
        }

        // The same guard for the environment. Environment-dependent code (the
        // hCaptcha test override) and the test-only HTTP fakes assume
        // APP_ENV=testing. A launcher exporting APP_ENV used to win over
        // phpunit.xml's <env> because Laravel reads $_SERVER first, so the
        // suite could pass while proving something other than what it claims.
        // phpunit.xml now pins it in $_SERVER; this fails loudly if that pin is
        // ever removed or another harness bootstraps the suite.
        $environment = (string) app()->environment();
        if ($environment !== 'testing') {
            throw new \RuntimeException("Refusing to run the suite outside the testing environment [{$environment}]. Set APP_ENV=testing; the test-only overrides and fakes assume it.");
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
            // El host público que la suite ejerce. Tiene que estar aquí y no en
            // cada test: `PUBLIC_HOST=localhost` entra por `.env`, que es lo que
            // produce el flujo documentado (`cp .env.example .env`), mientras
            // que CI corre sin `.env` y con el valor por defecto. Un test que
            // escribía `uvh.es` a mano pasaba en CI y fallaba en local por
            // construir la URL de un host que la aplicación no reconocía
            // (`resolveDomainId()` responde -1), no por el comportamiento que
            // decía probar.
            'uvh.public_host' => 'uvh.es',
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

    protected function tearDown(): void
    {
        foreach ($this->replacedServerEnvironment as $name => [$existed, $previous]) {
            if ($existed) {
                $_SERVER[$name] = $previous;
            } else {
                unset($_SERVER[$name]);
            }
        }

        $this->replacedServerEnvironment = [];

        parent::tearDown();
    }

    /**
     * Puts the value a test declared with `#[WithEnvironmentVariable]` where the
     * application actually reads it.
     *
     * PHPUnit's attribute writes `$_ENV` and putenv, but Laravel resolves `env()`
     * through phpdotenv, which reads `$_SERVER` first — and `.env` puts every key
     * it declares there during the first boot of the process. `CACHE_LIMITER=`
     * ships present but empty, so a test that overrode it was reading the empty
     * value left behind by whichever test booted first: green on its own, red in
     * the full run, and red on every documented local checkout while CI (which
     * has no `.env`) stayed green. The declaration stays in the attribute; this
     * mirrors it into `$_SERVER` before the application boots and `tearDown()`
     * restores what was there, so nothing leaks into the next test.
     */
    private function pinDeclaredEnvironmentOverrides(): void
    {
        $pinned = false;

        foreach ((new ReflectionMethod($this, $this->name()))->getAttributes(WithEnvironmentVariable::class) as $attribute) {
            $override = $attribute->newInstance();
            $name = $override->environmentVariableName();
            $pinned = true;

            if (! array_key_exists($name, $this->replacedServerEnvironment)) {
                $this->replacedServerEnvironment[$name] = [
                    array_key_exists($name, $_SERVER),
                    array_key_exists($name, $_SERVER) ? (string) $_SERVER[$name] : null,
                ];
            }

            // A null value means "absent" for the attribute, so it has to mean
            // the same here: an empty string is a value Laravel resolves.
            if ($override->value() === null) {
                unset($_SERVER[$name]);

                continue;
            }

            $_SERVER[$name] = $override->value();
        }

        if ($pinned) {
            // phpdotenv's immutable writer refuses to overwrite variables it sees
            // as externally defined, but only those it has not loaded itself, and
            // it remembers what it loaded for the whole process. `.env` therefore
            // wins over the declaration above from the second boot onwards: the
            // value the test set was already there and got replaced with
            // `CACHE_LIMITER=`'s empty string, which is why the test passed alone
            // and failed in the full run while CI, with no `.env` at all, stayed
            // green. Rebuilding the repository makes the next boot read the
            // environment as it finds it, which is what the first boot of a
            // process always did. `enablePutenv()` is the default state: the
            // point is the repository it resets.
            Env::enablePutenv();
        }
    }
}
