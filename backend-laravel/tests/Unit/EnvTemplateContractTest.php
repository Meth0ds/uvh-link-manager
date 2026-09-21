<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use Tests\Support\RepositoryRoot;

/**
 * Contract between the shipped production template and the code that reads it.
 *
 * `.env.production.example` is the file an operator copies to `.env.production`,
 * so every value in it is a promise about how the deployed system behaves. Two
 * ways that promise can quietly become false:
 *
 *  - the template ships a value the code does not use as a default, so a
 *    deployment that never touches the file runs with a setting nobody chose,
 *    and the two drift further apart every time one side is edited;
 *  - the template lists a name nothing reads. A typo in a key is invisible: the
 *    operator sets it, the system ignores it, and the setting appears to have
 *    no effect.
 *
 * Some differences are deliberate — production is not development, so it uses
 * its own hostname, its own proxy list, `__Host-` cookies and HSTS. Those are
 * declared below with a reason, and the list is held honest in both directions:
 * a difference that is not declared fails, and a declaration whose difference
 * disappeared also fails.
 *
 * Like `EdgeLimitContractTest`, this describes files outside `backend-laravel/`
 * and needs the repository root, which CI checks out.
 */
class EnvTemplateContractTest extends TestCase
{
    private const PRODUCTION_ENV = 'backend-laravel/.env.production.example';

    private const UVH_CONFIG = 'backend-laravel/config/uvh.php';

    /**
     * Keys whose template value is expected to differ from the code default,
     * because the difference *is* the deployment: an identifier, a hardened
     * cookie name, the topology, or a protection that is only safe to turn on
     * once TLS is terminated in front of the application.
     *
     * @var array<string, string>
     */
    private const PRODUCTION_OVERRIDES = [
        'APP_URL' => 'the deployment hostname; the default is the local development URL',
        'SESSION_COOKIE' => 'production uses the __Host- prefix, which requires Secure and no Domain',
        'CSRF_COOKIE' => 'same prefix rule as the session cookie',
        'PENDING_INVITATION_COOKIE' => 'same __Host- prefix rule as the session cookie: Secure, Path=/ and no Domain',
        'PENDING_INTENT_COOKIE' => 'same __Host- prefix rule as the session cookie: Secure, Path=/ and no Domain',
        'TRUSTED_PROXIES' => 'the deployment proxy network; empty by default, which trusts nobody',
        'EDGE_INTERNAL_CIDRS' => 'the deployment network the edge accepts internal traffic from',
        'HSTS_ENABLED' => 'only safe behind TLS termination; off by default so local HTTP keeps working',
    ];

    /**
     * Keys read by `config/uvh.php` and deliberately left out of the template.
     *
     * @var array<string, string>
     */
    private const KEYS_WITHOUT_A_TEMPLATE_ENTRY = [
        // Only honoured under APP_ENV=testing: anywhere else the verifier
        // refuses to start rather than let a compromised variable redirect the
        // captcha tokens. Advertising it in a production template would invite
        // exactly what the code forbids.
        'HCAPTCHA_VERIFY_URL' => 'testing-only override for the captcha verifier',
        // Safe defaults (7 days, verified accounts required) that the startup
        // gate already validates; a template entry would only add a way to
        // weaken them by accident.
        'EXPORT_PURGE_DAYS' => 'default 7 days, range checked at startup',
        'VERIFIED_REQUIRED_TO_CREATE' => 'default true, which is the safe value',
        // Empty by default: the pool is derived from the worker command, so the
        // variable only exists for a deployment that splits the queues.
        'UVH_QUEUE_POOL' => 'empty means derive the pool from the worker command',
        // Five per-recipient mail budgets with working defaults. Operator
        // surface, not deployment requirement; documented in configuration.md.
        'INVITATION_MAIL_ACTOR_DAY' => 'mail budget with a working default',
        'INVITATION_MAIL_GLOBAL_DAY' => 'mail budget with a working default',
        'INVITATION_MAIL_IP_DAY' => 'mail budget with a working default',
        'INVITATION_MAIL_RECIPIENT_DAY' => 'mail budget with a working default',
        'INVITATION_MAIL_WORKSPACE_DAY' => 'mail budget with a working default',
    ];

    /** Variables the edge consumes; no PHP file reads them. */
    private const EDGE_PREFIX = 'EDGE_';

    /**
     * The template as `KEY => value`, ignoring comments and blank lines.
     *
     * @return array<string, string>
     */
    private function template(): array
    {
        $values = [];
        foreach (explode("\n", RepositoryRoot::read(self::PRODUCTION_ENV)) as $line) {
            if (preg_match('/^([A-Z0-9_]+)=(.*)$/', trim($line), $matches)) {
                $values[$matches[1]] = trim($matches[2]);
            }
        }

        $this->assertGreaterThan(50, count($values), 'the template looks truncated');

        return $values;
    }

    /**
     * `config/uvh.php` defaults, for the `env()` calls whose default is a
     * literal.
     *
     * A derived default (`'https://'.env('PUBLIC_HOST', 'uvh.es')`) is out of
     * scope by construction: its value depends on another variable that this
     * same test compares on its own line, and matching it here would mean
     * evaluating PHP. Only literals are held to the template.
     *
     * @return array<string, string>
     */
    private function configDefaults(): array
    {
        preg_match_all(
            "/env\\(\\s*'([A-Z0-9_]+)'\\s*,\\s*(\\d+|true|false|null|'[^']*')\\s*\\)/",
            RepositoryRoot::read(self::UVH_CONFIG),
            $matches,
            PREG_SET_ORDER,
        );
        $this->assertNotSame([], $matches, 'config/uvh.php no longer declares env() defaults with the expected shape');

        $defaults = [];
        foreach ($matches as $match) {
            $defaults[$match[1]] = trim($match[2]);
        }

        return $defaults;
    }

    /**
     * One spelling per value, so `false`, `off`, `0` and an absent value compare
     * equal, as do `true`, `on` and `1`.
     */
    private function normalize(string $value): string
    {
        $value = trim(trim($value), '\'"');
        $lower = strtolower($value);

        return match (true) {
            in_array($lower, ['true', 'on', '1'], true) => 'true',
            in_array($lower, ['false', 'off', '0', 'null', ''], true) => 'false',
            default => $value,
        };
    }

    public function test_the_template_agrees_with_the_default_the_code_would_use_without_it(): void
    {
        $template = $this->template();
        $compared = 0;

        foreach ($this->configDefaults() as $key => $default) {
            if (! array_key_exists($key, $template)) {
                continue;
            }
            $compared++;

            if (array_key_exists($key, self::PRODUCTION_OVERRIDES)) {
                $this->assertNotSame(
                    $this->normalize($default),
                    $this->normalize($template[$key]),
                    "{$key} is declared as a deliberate production override, but the template and the code default agree now: "
                    .'remove the declaration so the next change to either side is compared again.',
                );
                $this->assertNotSame('', $template[$key], "{$key} is declared as an override but the template leaves it empty");

                continue;
            }

            $this->assertSame(
                $this->normalize($default),
                $this->normalize($template[$key]),
                sprintf(
                    '%s is %s in %s but the code falls back to %s. A deployment that copies the template and edits nothing '
                    .'then runs with a value the code was not written against; either align the two or declare the difference '
                    .'in PRODUCTION_OVERRIDES with the reason.',
                    $key,
                    $template[$key] === '' ? '(empty)' : $template[$key],
                    self::PRODUCTION_ENV,
                    $default,
                ),
            );
        }

        $this->assertGreaterThan(20, $compared, 'too few keys were compared for this contract to mean anything');
    }

    public function test_every_name_the_template_ships_is_read_by_something(): void
    {
        $configDirectory = RepositoryRoot::path().'/'.dirname(self::UVH_CONFIG);
        $phpConfigurations = '';
        foreach (glob($configDirectory.'/*.php') ?: [] as $file) {
            $phpConfigurations .= (string) file_get_contents($file);
        }
        $this->assertNotSame('', $phpConfigurations, 'no configuration file was read');

        foreach (array_keys($this->template()) as $key) {
            if (str_starts_with($key, self::EDGE_PREFIX)) {
                continue;
            }

            $this->assertMatchesRegularExpression(
                "/env\\(\\s*'".preg_quote($key, '/')."'/",
                $phpConfigurations,
                "{$key} is in ".self::PRODUCTION_ENV.' but no configuration file reads it: whoever sets it will see no effect.',
            );
        }
    }

    public function test_a_key_read_by_the_code_is_either_shipped_or_declared_absent(): void
    {
        $template = $this->template();

        foreach (array_keys($this->configDefaults()) as $key) {
            if (! array_key_exists($key, $template)) {
                $this->assertArrayHasKey(
                    $key,
                    self::KEYS_WITHOUT_A_TEMPLATE_ENTRY,
                    "{$key} is read by config/uvh.php and is not in ".self::PRODUCTION_ENV.'. Either add it to the template or '
                    .'declare here why a production deployment must not set it; leaving it in neither place is how the two files drift apart.',
                );

                continue;
            }

            $this->assertArrayNotHasKey(
                $key,
                self::KEYS_WITHOUT_A_TEMPLATE_ENTRY,
                "{$key} is shipped in the template and also declared as deliberately absent",
            );
        }
    }

    public function test_the_declarations_are_still_real(): void
    {
        $template = $this->template();
        $defaults = $this->configDefaults();

        foreach (self::KEYS_WITHOUT_A_TEMPLATE_ENTRY as $key => $reason) {
            $this->assertArrayNotHasKey($key, $template, "{$key} is now in the template, so it is no longer an omission");
            $this->assertArrayHasKey($key, $defaults, "{$key} is declared as an omitted config key but config/uvh.php no longer reads it");
            $this->assertNotSame('', $reason, "{$key} is declared without a reason");
        }

        foreach (self::PRODUCTION_OVERRIDES as $key => $reason) {
            $this->assertArrayHasKey($key, $template, "{$key} is declared as a production override but the template no longer ships it");
            $this->assertArrayHasKey($key, $defaults, "{$key} is declared as a production override but config/uvh.php no longer reads it");
            $this->assertNotSame('', $reason, "{$key} is declared without a reason");
        }
    }
}
