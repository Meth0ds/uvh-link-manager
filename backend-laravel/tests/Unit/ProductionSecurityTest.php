<?php

namespace Tests\Unit;

use App\Support\ProductionSecurity;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class ProductionSecurityTest extends TestCase
{
    public function test_secure_production_configuration_is_accepted(): void
    {
        $this->assertSame([], ProductionSecurity::errors($this->validSettings()));
    }

    public function test_development_captcha_fallback_prevents_production_startup(): void
    {
        $settings = $this->validSettings();
        $settings['hcaptcha_dev_fallback'] = true;
        $this->assertContains('HCAPTCHA_DEV_FALLBACK debe ser false en producción', ProductionSecurity::errors($settings));
    }

    #[DataProvider('unsafeProxyProvider')]
    public function test_unsafe_trusted_proxy_configuration_is_rejected(string $proxy): void
    {
        $this->assertFalse(ProductionSecurity::validTrustedProxies($proxy));
    }

    public static function unsafeProxyProvider(): array
    {
        return [
            'wildcard' => ['*'],
            'all ipv4' => ['0.0.0.0/0'],
            'all ipv6' => ['::/0'],
            'hostname' => ['proxy.internal'],
            'invalid cidr' => ['10.0.0.1/99'],
        ];
    }

    public function test_invalid_key_cookie_prefix_and_non_persistent_stores_fail_closed(): void
    {
        $settings = $this->validSettings();
        $settings['app_key'] = 'short';
        $settings['session_cookie'] = 'uvh_session';
        $settings['csrf_cookie'] = 'uvh_csrf';
        $settings['cache_store'] = 'array';
        $settings['queue_connection'] = 'sync';

        $errors = ProductionSecurity::errors($settings);

        $this->assertContains('APP_KEY debe ser una clave válida para el cifrado configurado', $errors);
        $this->assertContains('SESSION_COOKIE debe usar el prefijo __Host- en producción', $errors);
        $this->assertContains('CSRF_COOKIE debe usar el prefijo __Host- en producción', $errors);
        $this->assertContains('CACHE_STORE debe ser compartido entre procesos en producción', $errors);
        $this->assertContains('QUEUE_CONNECTION debe usar una cola persistente en producción', $errors);
    }

    public function test_redis_must_be_shared_and_authenticated(): void
    {
        $settings = $this->validSettings();
        $settings['cache_store'] = 'redis';
        $settings['queue_connection'] = 'redis';
        $settings['redis_connections'] = [[
            'host' => '127.0.0.1',
            'url' => '',
            'password' => 'change-me-please',
        ]];

        $errors = ProductionSecurity::errors($settings);

        // A loopback endpoint would give every process its own view of rate
        // limits and locks, which is the opposite of what a shared store is for.
        $this->assertContains('REDIS_HOST debe apuntar a un host compartido entre procesos, no a loopback, en producción', $errors);
        $this->assertContains('REDIS_PASSWORD debe ser un secreto concreto y robusto en producción', $errors);
    }

    public function test_a_shared_authenticated_redis_is_accepted(): void
    {
        $settings = $this->validSettings();
        $settings['cache_store'] = 'redis';
        $settings['queue_connection'] = 'redis';
        $settings['redis_connections'] = [[
            'host' => 'redis',
            'url' => '',
            'password' => 'kR7mQ2xP9sL4tW8bZ3cN6vD1fG5hJ0aY',
        ]];

        $this->assertSame([], ProductionSecurity::errors($settings));
    }

    public function test_a_redis_url_with_the_wrong_scheme_is_rejected(): void
    {
        $settings = $this->validSettings();
        $settings['cache_store'] = 'redis';
        $settings['redis_connections'] = [[
            'host' => '',
            'url' => 'http://cache.internal:6379',
            'password' => 'kR7mQ2xP9sL4tW8bZ3cN6vD1fG5hJ0aY',
        ]];

        $this->assertContains(
            'REDIS_URL debe usar el esquema redis:// o rediss:// en producción',
            ProductionSecurity::errors($settings),
        );
    }

    public function test_rate_limiting_must_count_where_every_process_can_see_it(): void
    {
        $settings = $this->validSettings();
        $settings['cache_limiter_driver'] = 'array';
        $this->assertContains(
            'CACHE_LIMITER debe usar uno o más stores compartidos entre procesos en producción',
            ProductionSecurity::errors($settings),
        );

        // A failover store is legitimate because every member is shared; one
        // that falls back to a per-process store is not, because the fallback
        // would stop limiting the moment it is used.
        $settings['cache_limiter_driver'] = 'failover';
        $settings['cache_failover_drivers'] = ['array'];
        $this->assertContains(
            'CACHE_LIMITER debe usar uno o más stores compartidos entre procesos en producción',
            ProductionSecurity::errors($settings),
        );

        $settings['cache_failover_drivers'] = ['redis', 'database'];
        $this->assertSame([], ProductionSecurity::errors($settings));
    }

    public function test_the_redis_queue_retry_window_is_a_release_gate(): void
    {
        // The Redis driver does not inherit DB_QUEUE_RETRY_AFTER, so switching
        // brokers without setting REDIS_QUEUE_RETRY_AFTER leaves the framework
        // default of 90 seconds. Accepting it would let a worker pick up a job
        // that another worker is still running, so it must stop the boot.
        $settings = $this->validSettings();
        $settings['queue_connection'] = 'redis';
        $settings['queue_retry_after'] = 90;
        $this->assertContains(
            'El retry_after de la cola debe estar entre 200 y 3600 segundos para superar el timeout máximo de los workers',
            ProductionSecurity::errors($settings),
        );

        $settings['queue_retry_after'] = 240;
        $this->assertSame([], ProductionSecurity::errors($settings));
    }

    #[DataProvider('unsafeAppUrlProvider')]
    public function test_app_url_must_be_the_exact_https_origin(string $url): void
    {
        $settings = $this->validSettings();
        $settings['app_url'] = $url;

        $this->assertContains(
            'APP_URL debe ser el origen HTTPS exacto de APP_HOST',
            ProductionSecurity::errors($settings),
        );
    }

    public static function unsafeAppUrlProvider(): array
    {
        return [
            'http' => ['http://app.uvh.es'],
            'credentials' => ['https://user@app.uvh.es'],
            'query' => ['https://app.uvh.es?next=https://evil.test'],
            'fragment' => ['https://app.uvh.es#token'],
            'path' => ['https://app.uvh.es/auth'],
            'unexpected port' => ['https://app.uvh.es:8443'],
            'wrong host' => ['https://uvh.es'],
        ];
    }

    public function test_public_origin_and_legal_identity_are_release_gates(): void
    {
        $settings = $this->validSettings();
        $settings['public_origin'] = 'http://uvh.es:8080';
        $settings['legal_registry'] = 'Pendiente de completar';

        $errors = ProductionSecurity::errors($settings);
        $this->assertContains('PUBLIC_ORIGIN debe ser el origen HTTPS exacto de PUBLIC_HOST', $errors);
        $this->assertContains(
            'La identidad legal del prestador debe estar completa y no contener marcadores pendientes',
            $errors,
        );
    }

    public function test_previous_secret_requires_a_short_lived_rotation_window(): void
    {
        $settings = $this->validSettings();
        $settings['app_secret_previous'] = ['qR8mN2vK5xP9sT4hC7jL1bF6wD3gA0eY8uI2oZ5cV7nM'];
        $settings['app_secret_rotation_until'] = gmdate(DATE_ATOM, time() + 86400);

        $this->assertSame([], ProductionSecurity::errors($settings));

        // An expired deadline must fail closed so previous keys cannot become
        // a permanent, forgotten decryption path in production.
        $settings['app_secret_rotation_until'] = gmdate(DATE_ATOM, time() - 60);
        $this->assertContains(
            'APP_SECRET_ROTATION_UNTIL debe ser una fecha futura dentro de los próximos 31 días',
            ProductionSecurity::errors($settings),
        );
    }

    public function test_rotation_rejects_duplicate_keys_and_orphan_deadlines(): void
    {
        $settings = $this->validSettings();
        $settings['app_secret_previous'] = [$settings['app_secret']];
        $settings['app_secret_rotation_until'] = gmdate(DATE_ATOM, time() + 86400);
        $this->assertContains(
            'APP_SECRET_PREVIOUS contiene una clave inválida, actual o duplicada',
            ProductionSecurity::errors($settings),
        );

        $settings = $this->validSettings();
        $settings['app_secret_rotation_until'] = gmdate(DATE_ATOM, time() + 86400);
        $this->assertContains(
            'APP_SECRET_ROTATION_UNTIL debe estar vacío cuando no hay claves anteriores',
            ProductionSecurity::errors($settings),
        );
    }

    public function test_production_rejects_logging_fallback_and_checks_nested_resend_key(): void
    {
        $settings = $this->validSettings();
        $settings['mail_config'] = ['default' => 'primary', 'mailers' => [
            'primary' => ['transport' => 'failover', 'mailers' => ['api', 'backup']],
            'api' => ['transport' => 'resend'],
            'backup' => ['transport' => 'log'],
        ]];
        $this->assertContains(
            'MAIL_MAILER debe entregar correo realmente en producción',
            ProductionSecurity::errors($settings),
        );

        $settings['mail_config']['mailers']['backup'] = ['transport' => 'smtp'];
        $settings['resend_key'] = '';
        $this->assertContains(
            'RESEND_API_KEY es obligatorio cuando se utiliza el transporte resend',
            ProductionSecurity::errors($settings),
        );
        $settings['mail_config']['mailers']['api']['key'] = 'fixture-provider-key';
        $this->assertSame([], ProductionSecurity::errors($settings));
    }

    private function validSettings(): array
    {
        return [
            'app_key' => 'base64:'.base64_encode(str_repeat('k', 32)),
            'cipher' => 'AES-256-CBC',
            'app_secret' => 'yM7T1K5pJ8qR2vW6xZ9cB3nF4hL0sD7gQ1uA5eE8iI2',
            'app_secret_previous' => [],
            'app_secret_rotation_until' => '',
            'debug' => false,
            'app_url' => 'https://app.uvh.es',
            'metrics_bearer_token' => 'M7cR2vN9xK4pL8sQ1wE6tY3uI5oP0aS7dF9gH2jK4lZ',
            'app_host' => 'app.uvh.es',
            'public_host' => 'uvh.es',
            'public_origin' => 'https://uvh.es',
            'legal_name' => 'UVH Servicios Digitales SL',
            'legal_tax_id' => 'B12345678',
            'legal_address' => 'Calle de prueba 1, 28001 Madrid, España',
            'legal_registry' => 'Registro Mercantil de Madrid, tomo 1, folio 2, hoja M-3',
            'legal_hosting_provider' => 'Proveedor de infraestructura de prueba SL',
            'legal_hosting_region' => 'España, Unión Europea',
            'cookie_secure' => true,
            'cookie_domain' => '',
            'session_cookie' => '__Host-uvh_session',
            'csrf_cookie' => '__Host-uvh_csrf',
            'hsts_enabled' => true,
            'session_ttl_days' => 30,
            'admin_mfa_fresh_minutes' => 15,
            'bcrypt_rounds' => 12,
            'hcaptcha_site_key' => '6f42dd45-49e8-4bb4-9aa7-production-sitekey',
            'hcaptcha_secret' => 'ES_6ba8805b75484845b996production-secret-value',
            'hcaptcha_public_site_key' => '89175bb8-bd34-47dc-9558-public-production-sitekey',
            'hcaptcha_public_secret' => 'ES_6ba8805b75484845b996public-secret-value',
            'hcaptcha_connect_timeout' => 2,
            'hcaptcha_timeout' => 5,
            'auth_limit' => 10,
            'register_limit' => 10,
            'link_create_limit' => 30,
            'resolve_limit' => 600,
            'api_token_limit' => 600,
            'trusted_proxies' => '10.0.0.10,172.16.0.0/12,2001:db8::1',
            'db_connection' => 'pgsql',
            'db_sslmode' => 'verify-full',
            'db_sslrootcert' => '/run/secrets/uvh_db_ca',
            'db_sslrootcert_readable' => true,
            'db_username' => 'uvh',
            'db_password' => 'Q8v!p2L#r7S@x4N$z9T',
            'cache_store' => 'database',
            'queue_connection' => 'database',
            'queue_retry_after' => 240,
            'queue_failed_driver' => 'database-uuids',
            'custom_domain_cname_target' => 'edge.uvh.es',
            'edge_ask_secret' => 'kD4sP8wN2xR7vT1mC6qH9bF3jL5zA0eG4uY8iO2pS7cQ',
            'acme_email' => 'operaciones@uvh.es',
            'edge_internal_host' => 'edge',
            'edge_internal_cidrs' => ['172.29.0.0/24'],
            'domain_verification_fresh_hours' => 24,
            'domain_revalidation_hours' => 24,
            'domain_failure_retry_hours' => 1,
            'domain_failure_grace_hours' => 2,
            'domain_max_failures' => 3,
            'mail_config' => ['default' => 'resend', 'mailers' => ['resend' => ['transport' => 'resend']]],
            'resend_key' => 're_test_key',
            'mail_from_address' => 'no-reply@uvh.es',
            'housekeeping_interval_minutes' => 60,
            'session_purge_days' => 30,
            'token_purge_days' => 7,
            'api_token_purge_days' => 30,
            'delivery_purge_days' => 90,
            'failed_job_purge_days' => 30,
            'mail_outbox_purge_days' => 30,
            'account_recovery_purge_days' => 90,
            'operational_metrics_purge_days' => 30,
            'privacy_request_purge_days' => 1095,
            'export_purge_days' => 7,
            'audit_purge_days' => 365,
            'analytics_retention_days' => 180,
        ];
    }
}
