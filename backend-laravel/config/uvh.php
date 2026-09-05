<?php

return [
    'metrics' => [
        'bearer_token' => env('METRICS_BEARER_TOKEN', ''),
    ],
    // Secreto de firma de sesión y cifrado at-rest. En producción es obligatorio.
    'secret' => env('APP_SECRET'),
    // Claves anteriores, separadas por comas, disponibles únicamente durante
    // una rotación controlada. Nunca se usan para cifrar datos nuevos.
    'secret_previous' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env('APP_SECRET_PREVIOUS', '')),
    ))),
    // Deadline ISO-8601 obligatorio mientras exista una clave anterior. El
    // gate de producción impide conservar indefinidamente un keyring ampliado.
    'secret_rotation_until' => env('APP_SECRET_ROTATION_UNTIL', ''),
    'public_host' => env('PUBLIC_HOST', 'uvh.es'),
    'app_host' => env('APP_HOST', parse_url((string) env('APP_URL', 'http://localhost:8000'), PHP_URL_HOST) ?: 'app.uvh.es'),
    'session_cookie' => env('SESSION_COOKIE', 'uvh_session'),
    'csrf_cookie' => env('CSRF_COOKIE', 'uvh_csrf'),
    'trusted_proxies' => env('TRUSTED_PROXIES', ''),
    'session_ttl_days' => (int) env('SESSION_TTL_DAYS', 30),
    // Privileged administration requires a recently presented second factor,
    // independently of the longer-lived authenticated session cookie.
    'admin_mfa_fresh_minutes' => (int) env('ADMIN_MFA_FRESH_MINUTES', 15),
    'hcaptcha' => [
        'site_key' => env('HCAPTCHA_SITE_KEY'),
        'secret' => env('HCAPTCHA_SECRET'),
        // Sitekey independiente para formularios antiabuso del host público.
        'public_site_key' => env('HCAPTCHA_PUBLIC_SITE_KEY'),
        'public_secret' => env('HCAPTCHA_PUBLIC_SECRET'),
        'connect_timeout_seconds' => (int) env('HCAPTCHA_CONNECT_TIMEOUT', 2),
        'timeout_seconds' => (int) env('HCAPTCHA_TIMEOUT', 5),
    ],
    'cookie_secure' => env('COOKIE_SECURE') !== null
        ? filter_var(env('COOKIE_SECURE'), FILTER_VALIDATE_BOOLEAN)
        : (env('APP_ENV') === 'production'),
    // Regla de seguridad crítica: sin dominio compartido; nunca ".uvh.es".
    'cookie_domain' => env('COOKIE_DOMAIN'),
    'verified_required_to_create' => filter_var(env('VERIFIED_REQUIRED_TO_CREATE', 'true'), FILTER_VALIDATE_BOOLEAN),
    'hsts_enabled' => filter_var(env('HSTS_ENABLED', 'false'), FILTER_VALIDATE_BOOLEAN),
    'trust_country_header' => filter_var(env('TRUST_COUNTRY_HEADER', 'false'), FILTER_VALIDATE_BOOLEAN),
    'country_header' => env('COUNTRY_HEADER', 'cf-ipcountry'),
    'reputation_provider_url' => env('REPUTATION_PROVIDER_URL'),
    'custom_domains' => [
        'cname_target' => env('CUSTOM_DOMAIN_CNAME_TARGET'),
        'edge_ask_secret' => env('EDGE_ASK_SECRET'),
        'acme_email' => env('ACME_EMAIL'),
        'edge_internal_host' => env('EDGE_INTERNAL_HOST', 'edge'),
        'edge_internal_cidrs' => array_values(array_filter(array_map(
            'trim',
            explode(',', (string) env('EDGE_INTERNAL_CIDRS', '')),
        ))),
        // A verified-but-not-active domain must prove ownership again after
        // this window before it may enter the redirect surface.
        'verification_fresh_hours' => (int) env('DOMAIN_VERIFICATION_FRESH_HOURS', 24),
        'revalidation_hours' => (int) env('DOMAIN_REVALIDATION_HOURS', 24),
        'failure_retry_hours' => (int) env('DOMAIN_FAILURE_RETRY_HOURS', 1),
        'failure_grace_hours' => (int) env('DOMAIN_FAILURE_GRACE_HOURS', 2),
        'max_failures' => (int) env('DOMAIN_MAX_FAILURES', 3),
    ],
    'housekeeping' => [
        'interval_minutes' => (int) env('HOUSEKEEPING_INTERVAL_MINUTES', 60),
        'session_purge_days' => (int) env('SESSION_PURGE_DAYS', 30),
        'token_purge_days' => (int) env('TOKEN_PURGE_DAYS', 7),
        'api_token_purge_days' => (int) env('API_TOKEN_PURGE_DAYS', 30),
        'delivery_purge_days' => (int) env('DELIVERY_PURGE_DAYS', 90),
        'failed_job_purge_days' => (int) env('FAILED_JOB_PURGE_DAYS', 30),
        'mail_outbox_purge_days' => (int) env('MAIL_OUTBOX_PURGE_DAYS', 30),
        'account_recovery_purge_days' => (int) env('ACCOUNT_RECOVERY_PURGE_DAYS', 90),
        'operational_metrics_purge_days' => (int) env('OPERATIONAL_METRICS_PURGE_DAYS', 30),
        'privacy_request_purge_days' => (int) env('PRIVACY_REQUEST_PURGE_DAYS', 1095),
        'export_purge_days' => (int) env('EXPORT_PURGE_DAYS', 7),
        'audit_purge_days' => (int) env('AUDIT_PURGE_DAYS', 365),
        'analytics_retention_days' => (int) env('ANALYTICS_RETENTION_DAYS', 180),
    ],
    // Initial admission allowances; windows last 24h from first admission,
    // except recipient_cooldown (60s). Never set to 0 to disable protection.
    'invitation_mail_budget' => [
        'actor_day' => (int) env('INVITATION_MAIL_ACTOR_DAY', 100),
        'workspace_day' => (int) env('INVITATION_MAIL_WORKSPACE_DAY', 200),
        'recipient_day' => (int) env('INVITATION_MAIL_RECIPIENT_DAY', 5),
        'ip_day' => (int) env('INVITATION_MAIL_IP_DAY', 200),
        'global_day' => (int) env('INVITATION_MAIL_GLOBAL_DAY', 2000),
        'recipient_cooldown' => 1,
    ],
    'rate_limits' => [
        'auth' => (int) env('AUTH_LIMIT', 10),
        'register' => (int) env('REGISTER_LIMIT', 10),
        'link_create' => (int) env('LINK_CREATE_LIMIT', 30),
        'resolve' => (int) env('RESOLVE_LIMIT', 600),
        'api_token' => (int) env('API_TOKEN_LIMIT', 600),
    ],
];
