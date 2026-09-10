<?php

namespace Tests\Unit;

use App\Support\HCaptcha;
use Illuminate\Config\Repository;
use Illuminate\Database\DatabaseManager;
use Illuminate\Foundation\Application;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Facade;
use Illuminate\Support\Facades\Http;
use Mockery;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/** No application bootstrap, migrations, real network or database connection. */
class HCaptchaDevelopmentFallbackTest extends TestCase
{
    private Application $app;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app = new Application;
        $this->app->instance('env', 'local');
        $this->app->instance('config', new Repository([
            'app' => ['debug' => true],
            'uvh' => ['app_host' => 'localhost', 'hcaptcha' => [
                'dev_fallback' => true,
                'site_key' => 'local-site-key-for-unit-tests',
                'secret' => 'local-secret-for-unit-tests',
                'public_site_key' => 'public-site-key-for-unit-tests',
                'public_secret' => 'public-secret-for-unit-tests',
            ]],
        ]));
        $this->app->instance('log', Mockery::mock(LoggerInterface::class)->shouldIgnoreMissing());
        Facade::clearResolvedInstances();
        Facade::setFacadeApplication($this->app);
        // Bind a pure double before resolving the facade. Never register the
        // database provider: even an accidental real connection must be impossible.
        $database = Mockery::mock(DatabaseManager::class);
        $database->shouldReceive('transactionLevel')->andReturn(0);
        $database->shouldReceive('statement')->andReturn(true);
        $this->app->instance('db', $database);
        Http::preventStrayRequests();
    }

    protected function tearDown(): void
    {
        Mockery::close();
        Facade::clearResolvedInstances();
        Facade::setFacadeApplication(null);
        Application::setInstance(null);
        parent::tearDown();
    }

    public function test_local_browser_failure_is_accepted_without_calling_the_provider(): void
    {
        $this->assertSame(HCaptcha::VALID, HCaptcha::verifyAuthentication(
            Request::create('http://localhost'), HCaptcha::DEVELOPMENT_FAILURE_TOKEN,
        ));
        Http::assertNothingSent();
    }

    #[DataProvider('closedGates')]
    public function test_every_gate_is_required(string $environment, mixed $debug, mixed $flag, string $appHost, string $url): void
    {
        $this->app->instance('env', $environment);
        config(['app.debug' => $debug, 'uvh.hcaptcha.dev_fallback' => $flag, 'uvh.app_host' => $appHost]);
        $request = Request::create($url);
        $this->assertFalse(HCaptcha::developmentFallbackAllowed($request));
        $this->assertSame(HCaptcha::INVALID, HCaptcha::verifyAuthentication($request, HCaptcha::DEVELOPMENT_FAILURE_TOKEN));
        Http::assertNothingSent();
    }

    public static function closedGates(): array
    {
        return [
            ['production', true, true, 'localhost', 'http://localhost'],
            ['staging', true, true, 'localhost', 'http://localhost'],
            ['testing', true, true, 'localhost', 'http://localhost'],
            ['development', true, true, 'localhost', 'http://localhost'],
            ['local', false, true, 'localhost', 'http://localhost'],
            ['local', true, false, 'localhost', 'http://localhost'],
            ['local', true, 'false', 'localhost', 'http://localhost'],
            ['local', true, true, 'app.example.com', 'http://localhost'],
            ['local', true, true, 'localhost', 'https://app.example.com'],
            ['local', true, true, 'localhost', 'http://localhost.example.com'],
        ];
    }

    public function test_only_authentication_outages_allow_fallback_not_public_reports(): void
    {
        Http::fake(['https://api.hcaptcha.com/siteverify' => Http::response('unavailable', 503)]);
        $request = Request::create('http://localhost');
        $this->assertSame(HCaptcha::VALID, HCaptcha::verifyAuthentication($request, 'ordinary-token'));
        $this->assertSame(HCaptcha::UNAVAILABLE, HCaptcha::verify($request, 'ordinary-token', 'public'));
        // A browser marker is not special in the raw/public verifier either.
        $this->assertSame(HCaptcha::UNAVAILABLE, HCaptcha::verify($request, HCaptcha::DEVELOPMENT_FAILURE_TOKEN, 'public'));
    }

    public function test_rejected_and_missing_tokens_stay_invalid_in_local_development(): void
    {
        Http::fake(['https://api.hcaptcha.com/siteverify' => Http::response(['success' => false])]);
        $request = Request::create('http://localhost');
        $this->assertSame(HCaptcha::INVALID, HCaptcha::verifyAuthentication($request, 'rejected-token'));
        $this->assertSame(HCaptcha::INVALID, HCaptcha::verifyAuthentication($request, ''));
    }

    public function test_server_outage_stays_closed_without_the_local_opt_in(): void
    {
        config(['uvh.hcaptcha.dev_fallback' => false]);
        Http::fake(['https://api.hcaptcha.com/siteverify' => Http::response('unavailable', 503)]);
        $this->assertSame(HCaptcha::UNAVAILABLE, HCaptcha::verifyAuthentication(Request::create('http://localhost'), 'ordinary-token'));
    }

    public function test_production_runtime_stays_closed_even_if_the_startup_guard_were_skipped(): void
    {
        $this->app->instance('env', 'production');
        Http::fake(['https://api.hcaptcha.com/siteverify' => Http::response('unavailable', 503)]);
        $this->assertSame(HCaptcha::UNAVAILABLE, HCaptcha::verifyAuthentication(Request::create('http://localhost'), 'ordinary-token'));
    }
}
