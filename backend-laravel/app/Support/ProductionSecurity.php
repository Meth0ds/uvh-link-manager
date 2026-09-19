<?php

namespace App\Support;

use Illuminate\Encryption\Encrypter;

final class ProductionSecurity
{
    /**
     * Stores whose contents are visible to every process. A rate limit or a
     * lock counted in one that is not shared only protects the process that
     * wrote it, which is indistinguishable from having no limit at all.
     */
    private const SHARED_CACHE_STORES = ['database', 'redis', 'memcached', 'dynamodb'];

    /**
     * Hosts that only ever serve the process they run in. Redis exists here to
     * be shared: a production deployment always runs more than one process
     * (PHP-FPM plus one worker per queue class plus the scheduler), so a
     * loopback endpoint would silently give each of them its own view of rate
     * limits and locks.
     */
    private const LOOPBACK_REDIS_HOSTS = ['127.0.0.1', 'localhost', '::1', '0.0.0.0'];

    /**
     * Capabilities of the PHP the deployment runs, as opposed to settings a
     * deployer writes.
     *
     * These live in the same release gate because both fail the same way: the
     * process starts and then misbehaves. `intl` is the one that matters here.
     * Without it an IDN host cannot be converted to its ASCII form, so an
     * internationalised domain can neither be validated as a destination nor
     * matched against the denylist — an entry for `münchen.example` would simply
     * never match. It is declared in `composer.json` and compiled into the image
     * (`docker/php/Dockerfile.production`); this check is what turns a forgotten
     * layer into a refused boot instead of a hole nobody sees.
     *
     * @return list<string>
     */
    public static function capabilityErrors(?bool $idnAvailable = null): array
    {
        $idnAvailable ??= function_exists('idn_to_ascii');
        if ($idnAvailable) {
            return [];
        }

        return ['La extensión intl de PHP es obligatoria: sin idn_to_ascii los destinos con host internacional no se pueden validar ni comparar con la denylist de destinos'];
    }

    /**
     * Validate invariants that must hold before a production worker serves a
     * request. Values are passed explicitly so the rules remain unit-testable
     * and work with Laravel's config cache.
     *
     * @param  array<string, mixed>  $settings
     * @return list<string>
     */
    public static function errors(array $settings): array
    {
        $errors = [];

        if (! self::validAppKey((string) ($settings['app_key'] ?? ''), (string) ($settings['cipher'] ?? ''))) {
            $errors[] = 'APP_KEY debe ser una clave válida para el cifrado configurado';
        }
        if (! self::validAppSecret(
            (string) ($settings['app_secret'] ?? ''),
            (string) ($settings['app_key'] ?? ''),
        )) {
            $errors[] = 'APP_SECRET debe ser Base64URL aleatorio, independiente y representar al menos 32 bytes en producción';
        }
        $previousSecrets = $settings['app_secret_previous'] ?? [];
        if (! is_array($previousSecrets) || count($previousSecrets) > 3) {
            $errors[] = 'APP_SECRET_PREVIOUS debe contener como máximo tres claves anteriores';
        } else {
            $seenSecrets = [(string) ($settings['app_secret'] ?? '')];
            foreach ($previousSecrets as $previousSecret) {
                if (! is_string($previousSecret)
                    || ! self::validAppSecret($previousSecret, (string) ($settings['app_key'] ?? ''))
                    || in_array($previousSecret, $seenSecrets, true)) {
                    $errors[] = 'APP_SECRET_PREVIOUS contiene una clave inválida, actual o duplicada';
                    break;
                }
                $seenSecrets[] = $previousSecret;
            }
        }
        $rotationUntil = trim((string) ($settings['app_secret_rotation_until'] ?? ''));
        if ($previousSecrets === []) {
            if ($rotationUntil !== '') {
                $errors[] = 'APP_SECRET_ROTATION_UNTIL debe estar vacío cuando no hay claves anteriores';
            }
        } else {
            $rotationDeadline = strtotime($rotationUntil);
            if ($rotationDeadline === false || $rotationDeadline <= time() || $rotationDeadline > time() + (31 * 86400)) {
                $errors[] = 'APP_SECRET_ROTATION_UNTIL debe ser una fecha futura dentro de los próximos 31 días';
            }
        }
        if ((bool) ($settings['debug'] ?? false)) {
            $errors[] = 'APP_DEBUG debe ser false en producción';
        }
        if (($settings['hcaptcha_dev_fallback'] ?? false) !== false) {
            $errors[] = 'HCAPTCHA_DEV_FALLBACK debe ser false en producción';
        }

        $appHost = strtolower((string) ($settings['app_host'] ?? ''));
        $publicHost = strtolower((string) ($settings['public_host'] ?? ''));
        if (! self::validHostname($appHost) || ! self::validHostname($publicHost) || $appHost === $publicHost) {
            $errors[] = 'PUBLIC_HOST y APP_HOST deben ser hosts DNS válidos, distintos y no vacíos';
        }
        if (! self::validAppUrl((string) ($settings['app_url'] ?? ''), $appHost)) {
            $errors[] = 'APP_URL debe ser el origen HTTPS exacto de APP_HOST';
        }
        if (! self::validAppUrl((string) ($settings['public_origin'] ?? ''), $publicHost)) {
            $errors[] = 'PUBLIC_ORIGIN debe ser el origen HTTPS exacto de PUBLIC_HOST';
        }
        if (! self::validLegalIdentity($settings)) {
            $errors[] = 'La identidad legal del prestador debe estar completa y no contener marcadores pendientes';
        }
        $metricsToken = (string) ($settings['metrics_bearer_token'] ?? '');
        if (strlen($metricsToken) < 43 || strlen($metricsToken) > 256 || preg_match('/[\x00-\x20\x7f]/', $metricsToken)) {
            $errors[] = 'METRICS_BEARER_TOKEN debe ser un secreto aleatorio de al menos 43 caracteres sin espacios';
        }

        if (! (bool) ($settings['cookie_secure'] ?? false)) {
            $errors[] = 'COOKIE_SECURE debe estar activado en producción';
        }
        if ((string) ($settings['cookie_domain'] ?? '') !== '') {
            $errors[] = 'COOKIE_DOMAIN debe permanecer vacío para aislar app.uvh.es';
        }
        // Every cookie this deployment sets on the panel origin carries the
        // __Host- prefix — Secure, Path=/ and no Domain — which is what keeps a
        // sibling host from shadowing it. The two parked-handoff cookies joined
        // the session and CSRF cookies, so the rule is applied to the set: a
        // name added later is checked by being listed here, not by remembering
        // to write a fifth `if`.
        $cookieNames = [
            'SESSION_COOKIE' => (string) ($settings['session_cookie'] ?? ''),
            'CSRF_COOKIE' => (string) ($settings['csrf_cookie'] ?? ''),
            'PENDING_INVITATION_COOKIE' => (string) ($settings['invitation_cookie'] ?? ''),
            'PENDING_INTENT_COOKIE' => (string) ($settings['intent_cookie'] ?? ''),
        ];
        foreach ($cookieNames as $key => $name) {
            if (! str_starts_with($name, '__Host-')) {
                $errors[] = "{$key} debe usar el prefijo __Host- en producción";
            }
        }
        if (count(array_unique(array_values($cookieNames))) !== count($cookieNames)) {
            $errors[] = 'Las cookies de sesión, CSRF y aparcadero deben tener nombres distintos';
        }
        if (! (bool) ($settings['hsts_enabled'] ?? false)) {
            $errors[] = 'HSTS_ENABLED debe estar activado en producción';
        }
        if (! self::inRange($settings['session_ttl_days'] ?? null, 1, 30)) {
            $errors[] = 'SESSION_TTL_DAYS debe estar entre 1 y 30 en producción';
        }
        // Both bounds are also the ceiling of the cookie that parks the bearer,
        // so an absurd value would keep a browser holding it for that long.
        if (! self::inRange($settings['invitation_ttl_days'] ?? null, 1, 30)) {
            $errors[] = 'INVITATION_TTL_DAYS debe estar entre 1 y 30 en producción';
        }
        if (! self::inRange($settings['intent_ttl_hours'] ?? null, 1, 168)) {
            $errors[] = 'INTENT_TTL_HOURS debe estar entre 1 y 168 en producción';
        }
        if (! self::inRange($settings['admin_mfa_fresh_minutes'] ?? null, 5, 60)) {
            $errors[] = 'ADMIN_MFA_FRESH_MINUTES debe estar entre 5 y 60 en producción';
        }
        if (! self::inRange($settings['bcrypt_rounds'] ?? null, 12, 16)) {
            $errors[] = 'BCRYPT_ROUNDS debe estar entre 12 y 16 en producción';
        }
        if (! self::validHCaptchaConfiguration(
            (string) ($settings['hcaptcha_site_key'] ?? ''),
            (string) ($settings['hcaptcha_secret'] ?? ''),
        )) {
            $errors[] = 'HCAPTCHA_SITE_KEY y HCAPTCHA_SECRET deben ser claves reales, distintas y no de prueba en producción';
        }
        if (! self::validHCaptchaConfiguration(
            (string) ($settings['hcaptcha_public_site_key'] ?? ''),
            (string) ($settings['hcaptcha_public_secret'] ?? ''),
        ) || hash_equals(
            (string) ($settings['hcaptcha_site_key'] ?? ''),
            (string) ($settings['hcaptcha_public_site_key'] ?? ''),
        )) {
            $errors[] = 'HCAPTCHA_PUBLIC_SITE_KEY debe ser una credencial real e independiente para el host público';
        }
        if (! self::inRange($settings['hcaptcha_connect_timeout'] ?? null, 1, 5)
            || ! self::inRange($settings['hcaptcha_timeout'] ?? null, 2, 10)
            || (int) ($settings['hcaptcha_timeout'] ?? 0) < (int) ($settings['hcaptcha_connect_timeout'] ?? 0)) {
            $errors[] = 'Los timeouts de hCaptcha deben ser acotados y coherentes en producción';
        }

        $rateLimitsValid = self::inRange($settings['auth_limit'] ?? null, 3, 30)
            && self::inRange($settings['register_limit'] ?? null, 1, 100)
            && self::inRange($settings['link_create_limit'] ?? null, 1, 300)
            && self::inRange($settings['resolve_limit'] ?? null, 60, 10_000)
            && self::inRange($settings['api_token_limit'] ?? null, 60, 10_000)
            && self::inRange($settings['pending_limit'] ?? null, 1, 300)
            && self::inRange($settings['pending_read_limit'] ?? null, 1, 1_000);
        if (! $rateLimitsValid) {
            $errors[] = 'Los límites de frecuencia deben permanecer dentro de rangos operativos seguros';
        }

        if (! self::validTrustedProxies((string) ($settings['trusted_proxies'] ?? ''))) {
            $errors[] = 'TRUSTED_PROXIES debe contener sólo IP/CIDR concretos; se prohíben comodines y redes universales';
        }
        if ((string) ($settings['db_connection'] ?? '') !== 'pgsql') {
            $errors[] = 'DB_CONNECTION debe ser pgsql en producción';
        }
        if ((string) ($settings['db_sslmode'] ?? '') !== 'verify-full') {
            $errors[] = 'DB_SSLMODE debe ser verify-full en producción';
        }
        $dbCaPath = (string) ($settings['db_sslrootcert'] ?? '');
        if (! str_starts_with($dbCaPath, '/') || ! (bool) ($settings['db_sslrootcert_readable'] ?? false)) {
            $errors[] = 'DB_SSLROOTCERT debe apuntar a un CA PEM absoluto y legible dentro del contenedor';
        }
        if (! self::validDatabaseCredential(
            (string) ($settings['db_username'] ?? ''),
            (string) ($settings['db_password'] ?? ''),
        )) {
            $errors[] = 'Las credenciales de PostgreSQL deben ser concretas y la contraseña debe ser robusta';
        }
        if (! in_array((string) ($settings['cache_store'] ?? ''), self::SHARED_CACHE_STORES, true)) {
            $errors[] = 'CACHE_STORE debe ser compartido entre procesos en producción';
        }
        if (! self::validLimiterStore($settings)) {
            $errors[] = 'CACHE_LIMITER debe usar uno o más stores compartidos entre procesos en producción';
        }
        if (! self::validSecurityLimiterStore($settings)) {
            $errors[] = 'CACHE_LIMITER_SECURITY debe usar un store compartido propio, ni la cadena de failover ni Redis';
        }
        foreach (self::redisErrors($settings) as $redisError) {
            $errors[] = $redisError;
        }
        if (in_array((string) ($settings['queue_connection'] ?? ''), ['', 'sync', 'null', 'background', 'deferred', 'failover'], true)) {
            $errors[] = 'QUEUE_CONNECTION debe usar una cola persistente en producción';
        }
        if (! self::inRange($settings['queue_retry_after'] ?? null, 200, 3600)) {
            $errors[] = 'El retry_after de la cola debe estar entre 200 y 3600 segundos para superar el timeout máximo de los workers';
        }
        if (in_array((string) ($settings['queue_failed_driver'] ?? ''), ['', 'null'], true)) {
            $errors[] = 'QUEUE_FAILED_DRIVER debe conservar los jobs agotados para operación y diagnóstico';
        }

        $cnameTarget = strtolower(trim((string) ($settings['custom_domain_cname_target'] ?? ''), '.'));
        if (! self::validHostname($cnameTarget) || in_array($cnameTarget, [$appHost, $publicHost], true)) {
            $errors[] = 'CUSTOM_DOMAIN_CNAME_TARGET debe ser un hostname DNS válido y distinto de APP_HOST/PUBLIC_HOST';
        }
        $edgeSecret = (string) ($settings['edge_ask_secret'] ?? '');
        if (preg_match('/^[A-Za-z0-9_-]{43,128}$/D', $edgeSecret) !== 1
            || hash_equals($edgeSecret, (string) ($settings['app_secret'] ?? ''))
            || preg_match('/(?:change.?me|example|password|secret)/i', $edgeSecret)) {
            $errors[] = 'EDGE_ASK_SECRET debe ser Base64URL aleatorio, independiente y tener entre 43 y 128 caracteres';
        }
        $acmeEmail = trim((string) ($settings['acme_email'] ?? ''));
        if (strlen($acmeEmail) > 254 || filter_var($acmeEmail, FILTER_VALIDATE_EMAIL) === false
            || preg_match('/[\x00-\x20\x7f]/', $acmeEmail)) {
            $errors[] = 'ACME_EMAIL debe ser una dirección válida sin caracteres de control';
        }
        $edgeInternalHost = (string) ($settings['edge_internal_host'] ?? '');
        if (preg_match('/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/D', $edgeInternalHost) !== 1) {
            $errors[] = 'EDGE_INTERNAL_HOST debe ser un nombre interno simple y válido';
        }
        if (! PrivateIpv4Network::validConfiguredCidrs($settings['edge_internal_cidrs'] ?? null)) {
            $errors[] = 'EDGE_INTERNAL_CIDRS debe contener uno o más CIDR IPv4 RFC1918 normalizados entre /24 y /32';
        }
        if (! self::inRange($settings['domain_verification_fresh_hours'] ?? null, 1, 168)
            || ! self::inRange($settings['domain_revalidation_hours'] ?? null, 1, 168)
            || ! self::inRange($settings['domain_failure_retry_hours'] ?? null, 1, 24)
            || ! self::inRange($settings['domain_failure_grace_hours'] ?? null, 1, 24)
            || ! self::inRange($settings['domain_max_failures'] ?? null, 2, 10)) {
            $errors[] = 'Los intervalos de verificación DNS deben permanecer dentro de límites seguros';
        }

        $mailLeaves = MailTransportPolicy::deliveryLeaves($settings['mail_config'] ?? null);
        if ($mailLeaves === null) {
            $errors[] = 'MAIL_MAILER debe entregar correo realmente en producción';
        }
        foreach ($mailLeaves ?? [] as $mailLeaf) {
            if ($mailLeaf['transport'] === 'resend'
                && trim((string) ($mailLeaf['key'] ?? $settings['resend_key'] ?? '')) === '') {
                $errors[] = 'RESEND_API_KEY es obligatorio cuando se utiliza el transporte resend';
                break;
            }
        }
        $mailFrom = trim((string) ($settings['mail_from_address'] ?? ''));
        if (strlen($mailFrom) > 254 || filter_var($mailFrom, FILTER_VALIDATE_EMAIL) === false
            || preg_match('/[\x00-\x20\x7f]/', $mailFrom)) {
            $errors[] = 'MAIL_FROM_ADDRESS debe ser una dirección de remitente válida';
        }

        $retentionValid = self::inRange($settings['housekeeping_interval_minutes'] ?? null, 1, 1440)
            && self::inRange($settings['session_purge_days'] ?? null, 1, 365)
            && self::inRange($settings['token_purge_days'] ?? null, 1, 90)
            && self::inRange($settings['api_token_purge_days'] ?? null, 7, 365)
            && self::inRange($settings['delivery_purge_days'] ?? null, 7, 365)
            && self::inRange($settings['failed_job_purge_days'] ?? null, 1, 365)
            && self::inRange($settings['mail_outbox_purge_days'] ?? null, 7, 365)
            && self::inRange($settings['account_recovery_purge_days'] ?? null, 30, 3650)
            && self::inRange($settings['operational_metrics_purge_days'] ?? null, 7, 365)
            && self::inRange($settings['privacy_request_purge_days'] ?? null, 365, 3650)
            && self::inRange($settings['export_purge_days'] ?? null, 1, 30)
            && self::inRange($settings['audit_purge_days'] ?? null, 30, 3650)
            && self::inRange($settings['analytics_retention_days'] ?? null, 1, 730);
        if (! $retentionValid) {
            $errors[] = 'Los intervalos de housekeeping y conservación deben permanecer dentro de límites seguros';
        }

        return $errors;
    }

    /**
     * The credential limiters must count where every process can see them *and*
     * where the counter cannot restart.
     *
     * Three things are refused, each for its own reason:
     *
     *  - **Empty.** Without it the credential limiters silently keep using the
     *    availability store, which in production is a failover chain: the very
     *    discontinuity this setting exists to remove would remain, invisible.
     *  - **A failover chain.** Its second member is a second, empty counter, so
     *    an outage of the first grants a fresh budget for as long as it lasts.
     *  - **Redis.** It is the dependency whose outage this separation exists to
     *    survive, and `login` must keep working when it falls. A deployment that
     *    wants credential counters on a shared Redis is choosing to trade that
     *    property away, and has to say so by changing this rule.
     *
     * `database` is the shipped value: it is already a hard requirement of every
     * request, so its availability adds no new dependency.
     *
     * @param  array<string, mixed>  $settings
     */
    private static function validSecurityLimiterStore(array $settings): bool
    {
        $driver = $settings['cache_limiter_security_driver'] ?? null;
        if (! is_string($driver) || $driver === '') {
            return false;
        }

        return in_array($driver, ['database', 'memcached', 'dynamodb'], true);
    }

    /**
     * The rate limiter must count attempts where every process can see them.
     * A failover store is allowed because each of its members is shared, which
     * is what keeps public throttling working while the first backend is down.
     *
     * @param  array<string, mixed>  $settings
     */
    private static function validLimiterStore(array $settings): bool
    {
        $driver = $settings['cache_limiter_driver'] ?? null;
        if (! is_string($driver) || $driver === '') {
            // No dedicated store: the limiter inherits cache.default, which the
            // rule above already requires to be shared.
            return true;
        }

        if ($driver !== 'failover') {
            return in_array($driver, self::SHARED_CACHE_STORES, true);
        }

        $members = $settings['cache_failover_drivers'] ?? [];
        if (! is_array($members) || $members === []) {
            return false;
        }
        foreach ($members as $member) {
            if (! in_array((string) $member, self::SHARED_CACHE_STORES, true)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Errors for the Redis connections this deployment actually reads.
     *
     * Only connections in use are checked: a deployment running Memcached must
     * not be rejected by an unrelated Redis setting it never contacts. The
     * remaining errors are the ones an operator has to fix, and they complete
     * to at most one per rule because the settings they name are shared across
     * connections — reporting the same broken REDIS_HOST once per connection
     * would dilute the message without adding anything to act on.
     *
     * @param  array<string, mixed>  $settings
     * @return list<string>
     */
    private static function redisErrors(array $settings): array
    {
        $connections = $settings['redis_connections'] ?? [];
        if (! is_array($connections)) {
            return [];
        }

        $errors = [];
        foreach ($connections as $connection) {
            if (! is_array($connection)) {
                continue;
            }

            $host = strtolower(trim((string) ($connection['host'] ?? ''), '[]'));
            $url = trim((string) ($connection['url'] ?? ''));
            if ($url !== '') {
                $parts = parse_url($url);
                if (! is_array($parts)
                    || ! in_array(strtolower((string) ($parts['scheme'] ?? '')), ['redis', 'rediss'], true)) {
                    $errors[] = 'REDIS_URL debe usar el esquema redis:// o rediss:// en producción';

                    continue;
                }
                $host = strtolower(trim((string) ($parts['host'] ?? ''), '[]'));
            }

            if ($host === '' || in_array($host, self::LOOPBACK_REDIS_HOSTS, true)) {
                $errors[] = 'REDIS_HOST debe apuntar a un host compartido entre procesos, no a loopback, en producción';
            }

            if (! self::validRedisPassword((string) ($connection['password'] ?? ''))) {
                $errors[] = 'REDIS_PASSWORD debe ser un secreto concreto y robusto en producción';
            }
        }

        return array_values(array_unique($errors));
    }

    private static function validRedisPassword(string $password): bool
    {
        if (strlen($password) < 16 || strlen($password) > 512 || preg_match('/[\x00-\x20\x7f]/', $password) === 1) {
            return false;
        }

        return preg_match('/(?:change.?me|example|password|local-only)/i', $password) !== 1;
    }

    /** @param array<string, mixed> $settings */
    private static function validLegalIdentity(array $settings): bool
    {
        $limits = [
            'legal_name' => [2, 200],
            'legal_tax_id' => [3, 40],
            'legal_address' => [10, 500],
            'legal_registry' => [3, 500],
            'legal_hosting_provider' => [2, 200],
            'legal_hosting_region' => [2, 200],
        ];
        foreach ($limits as $key => [$minimum, $maximum]) {
            $value = trim((string) ($settings[$key] ?? ''));
            if (! mb_check_encoding($value, 'UTF-8')
                || mb_strlen($value) < $minimum
                || mb_strlen($value) > $maximum
                || preg_match('/[\x00-\x1f\x7f]/u', $value)
                || preg_match('/(?:\bpendiente\b|por completar|\btodo\b|\btbd\b|change.?me|example)/iu', $value)) {
                return false;
            }
        }

        return true;
    }

    public static function validTrustedProxies(string $raw): bool
    {
        $proxies = array_values(array_filter(array_map('trim', explode(',', $raw))));
        if ($proxies === []) {
            return false;
        }

        foreach ($proxies as $proxy) {
            if (in_array($proxy, ['*', '0.0.0.0/0', '::/0'], true)) {
                return false;
            }
            [$ip, $prefix] = array_pad(explode('/', $proxy, 2), 2, null);
            if (filter_var($ip, FILTER_VALIDATE_IP) === false) {
                return false;
            }
            if ($prefix !== null) {
                if (! ctype_digit($prefix)) {
                    return false;
                }
                $max = filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false ? 32 : 128;
                $bits = (int) $prefix;
                if ($bits < 1 || $bits > $max) {
                    return false;
                }
            }
        }

        return true;
    }

    private static function validAppKey(string $key, string $cipher): bool
    {
        if (str_starts_with($key, 'base64:')) {
            $decoded = base64_decode(substr($key, 7), true);
            if ($decoded === false) {
                return false;
            }
            $key = $decoded;
        }

        return $key !== '' && Encrypter::supported($key, $cipher);
    }

    private static function validAppSecret(string $secret, string $appKey): bool
    {
        if (preg_match('/^[A-Za-z0-9_-]{43,128}$/D', $secret) !== 1 || hash_equals($secret, $appKey)) {
            return false;
        }

        if (preg_match('/^(.)\1+$/s', $secret) === 1) {
            return false;
        }

        $normalized = strtolower($secret);
        foreach (['change-me', 'changeme', 'development', 'password', 'example', 'local-only'] as $placeholder) {
            if (str_contains($normalized, $placeholder)) {
                return false;
            }
        }

        return true;
    }

    private static function validDatabaseCredential(string $username, string $password): bool
    {
        if ($username === '' || strlen($username) > 128 || preg_match('/[\x00-\x20\x7f]/', $username)) {
            return false;
        }
        if (strlen($password) < 16 || strlen($password) > 512 || preg_match('/[\x00\r\n]/', $password)) {
            return false;
        }

        return preg_match('/(?:change.?me|example|password|local-only)/i', $password) !== 1;
    }

    private static function validHCaptchaConfiguration(string $siteKey, string $secret): bool
    {
        $siteKey = trim($siteKey);
        $secret = trim($secret);
        $testSiteKey = '10000000-ffff-ffff-ffff-000000000001';
        $testSecret = '0x0000000000000000000000000000000000000000';

        return strlen($siteKey) >= 20
            && strlen($siteKey) <= 200
            && strlen($secret) >= 20
            && strlen($secret) <= 500
            && ! hash_equals($siteKey, $secret)
            && ! hash_equals($testSiteKey, $siteKey)
            && ! hash_equals($testSecret, $secret)
            && ! preg_match('/(?:change.?me|example|test.?key|your.?secret)/i', $siteKey.' '.$secret);
    }

    private static function inRange(mixed $value, int $min, int $max): bool
    {
        return is_int($value) && $value >= $min && $value <= $max;
    }

    public static function validHostname(string $host): bool
    {
        return strlen($host) <= 253
            && preg_match('/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/D', $host) === 1;
    }

    private static function validAppUrl(string $url, string $appHost): bool
    {
        $parts = parse_url($url);
        if (! is_array($parts) || strtolower((string) ($parts['scheme'] ?? '')) !== 'https') {
            return false;
        }

        return strtolower((string) ($parts['host'] ?? '')) === $appHost
            && ! array_key_exists('user', $parts)
            && ! array_key_exists('pass', $parts)
            && ! array_key_exists('query', $parts)
            && ! array_key_exists('fragment', $parts)
            && (! isset($parts['port']) || (int) $parts['port'] === 443)
            && (! isset($parts['path']) || $parts['path'] === '' || $parts['path'] === '/');
    }
}
