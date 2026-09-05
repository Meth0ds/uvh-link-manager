<?php

namespace App\Support;

use Illuminate\Encryption\Encrypter;

final class ProductionSecurity
{
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

        $appHost = strtolower((string) ($settings['app_host'] ?? ''));
        $publicHost = strtolower((string) ($settings['public_host'] ?? ''));
        if (! self::validHostname($appHost) || ! self::validHostname($publicHost) || $appHost === $publicHost) {
            $errors[] = 'PUBLIC_HOST y APP_HOST deben ser hosts DNS válidos, distintos y no vacíos';
        }
        if (! self::validAppUrl((string) ($settings['app_url'] ?? ''), $appHost)) {
            $errors[] = 'APP_URL debe ser el origen HTTPS exacto de APP_HOST';
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
        if (! str_starts_with((string) ($settings['session_cookie'] ?? ''), '__Host-')) {
            $errors[] = 'SESSION_COOKIE debe usar el prefijo __Host- en producción';
        }
        if (! str_starts_with((string) ($settings['csrf_cookie'] ?? ''), '__Host-')) {
            $errors[] = 'CSRF_COOKIE debe usar el prefijo __Host- en producción';
        }
        if ((string) ($settings['session_cookie'] ?? '') === (string) ($settings['csrf_cookie'] ?? '')) {
            $errors[] = 'SESSION_COOKIE y CSRF_COOKIE deben tener nombres distintos';
        }
        if (! (bool) ($settings['hsts_enabled'] ?? false)) {
            $errors[] = 'HSTS_ENABLED debe estar activado en producción';
        }
        if (! self::inRange($settings['session_ttl_days'] ?? null, 1, 30)) {
            $errors[] = 'SESSION_TTL_DAYS debe estar entre 1 y 30 en producción';
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
            && self::inRange($settings['api_token_limit'] ?? null, 60, 10_000);
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
        if (! in_array((string) ($settings['cache_store'] ?? ''), ['database', 'redis', 'memcached', 'dynamodb'], true)) {
            $errors[] = 'CACHE_STORE debe ser compartido entre procesos en producción';
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
