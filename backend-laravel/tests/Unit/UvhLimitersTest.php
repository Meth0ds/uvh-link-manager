<?php

namespace Tests\Unit;

use App\Support\UvhLimiters;
use PHPUnit\Framework\TestCase;
use Tests\Support\RepositoryRoot;

/**
 * Holds the three ends of the limiter split together.
 *
 * A name in `UvhLimiters::SECURITY` only changes where attempts are counted if
 * it is also registered as a named limiter *and* used from a route behind
 * `throttle:`. Renaming a limiter, or classifying one without wiring it, would
 * otherwise leave a credential surface silently counting on the availability
 * chain — the exact failure this separation removes.
 */
final class UvhLimitersTest extends TestCase
{
    private const PROVIDER = 'backend-laravel/app/Providers/AppServiceProvider.php';

    private const ROUTES = 'backend-laravel/routes/api.php';

    private const BOOTSTRAP = 'backend-laravel/bootstrap/app.php';

    public function test_every_credential_limiter_is_registered_and_used_by_a_route(): void
    {
        $provider = RepositoryRoot::read(self::PROVIDER);
        $routes = RepositoryRoot::read(self::ROUTES);

        $this->assertNotSame([], UvhLimiters::SECURITY);

        foreach (UvhLimiters::SECURITY as $name) {
            $this->assertMatchesRegularExpression(
                "/RateLimiter::for\\('".preg_quote($name, '/')."'/",
                $provider,
                "{$name} is classified as a credential limiter but is not registered",
            );
            $this->assertStringContainsString(
                'throttle:'.$name,
                $routes,
                "{$name} is classified as a credential limiter but no route uses it",
            );
        }
    }

    public function test_volume_limiters_stay_on_the_availability_store(): void
    {
        // These bound traffic, not guessing, and their whole purpose is to keep
        // the public surface and the panel served during a backend outage.
        // Moving them to the durable store would trade that away for nothing.
        foreach (['uvh-resolve', 'uvh-status', 'uvh-report', 'uvh-api', 'uvh-link-create', 'uvh-pending', 'uvh-pending-read'] as $name) {
            $this->assertFalse(UvhLimiters::isSecurity($name), "{$name} must keep counting on the availability store");
        }
    }

    /**
     * `throttle:a,b` is one declaration with two limiters, and Laravel applies
     * both. Comparing the raw string answered "not security" for any such pair,
     * so adding a second limiter to a credential route — the most natural edit
     * there is — would have moved the login budget back onto the failover chain
     * without a single test or log line noticing.
     */
    public function test_a_comma_separated_declaration_is_classified_by_its_members(): void
    {
        $this->assertTrue(UvhLimiters::isSecurity('uvh-login,uvh-mfa'));
        $this->assertTrue(UvhLimiters::isSecurity('uvh-api,uvh-login'));
        $this->assertTrue(UvhLimiters::isSecurity(' uvh-login , uvh-api '));
        $this->assertFalse(UvhLimiters::isSecurity('uvh-api,uvh-status'));
        $this->assertFalse(UvhLimiters::isSecurity(''));
        $this->assertFalse(UvhLimiters::isSecurity('not-a-limiter'));
    }

    public function test_the_throttle_alias_is_replaced_so_the_split_actually_applies(): void
    {
        // The framework's own `throttle` alias resolves `ThrottleRequests`
        // directly; without this override every limiter would keep counting on
        // the availability store no matter what `UvhLimiters` says.
        $this->assertMatchesRegularExpression(
            "/'throttle' => UvhThrottleRequests::class/",
            RepositoryRoot::read(self::BOOTSTRAP),
        );
    }
}
