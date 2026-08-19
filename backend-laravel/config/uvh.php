<?php

return [
    // Secreto de firma de sesión y cifrado at-rest. En producción es obligatorio.
    'secret' => env('APP_SECRET'),
    'public_host' => env('PUBLIC_HOST', 'uvh.es'),
    'app_host' => env('APP_HOST', parse_url((string) env('APP_URL', 'http://localhost:8000'), PHP_URL_HOST) ?: 'app.uvh.es'),
    'session_cookie' => env('SESSION_COOKIE', 'uvh_session'),
    'csrf_cookie' => env('CSRF_COOKIE', 'uvh_csrf'),
    'session_ttl_days' => (int) env('SESSION_TTL_DAYS', 30),
    'cookie_secure' => env('COOKIE_SECURE') !== null
        ? filter_var(env('COOKIE_SECURE'), FILTER_VALIDATE_BOOLEAN)
        : (env('APP_ENV') === 'production'),
    // Regla de seguridad crítica: sin dominio compartido; nunca ".uvh.es".
    'cookie_domain' => env('COOKIE_DOMAIN'),
    'verified_required_to_create' => filter_var(env('VERIFIED_REQUIRED_TO_CREATE', 'true'), FILTER_VALIDATE_BOOLEAN),
    'hsts_enabled' => filter_var(env('HSTS_ENABLED', 'false'), FILTER_VALIDATE_BOOLEAN),
    'trust_country_header' => filter_var(env('TRUST_COUNTRY_HEADER', 'false'), FILTER_VALIDATE_BOOLEAN),
    'country_header' => env('COUNTRY_HEADER', 'cf-ipcountry'),
    'rate_limits' => [
        'auth' => (int) env('AUTH_LIMIT', 10),
        'register' => (int) env('REGISTER_LIMIT', 10),
        'link_create' => (int) env('LINK_CREATE_LIMIT', 30),
        'resolve' => (int) env('RESOLVE_LIMIT', 600),
        'api_token' => (int) env('API_TOKEN_LIMIT', 600),
    ],
];
