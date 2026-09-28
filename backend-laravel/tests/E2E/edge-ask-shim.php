<?php

declare(strict_types=1);

/**
 * Secret-injection shim for Caddy's On-Demand TLS ask and per-request
 * authorization.
 *
 * In production only Nginx's internal listener can attach the shared secret to
 * `/internal/caddy/ask` — Caddy cannot set headers on its own ask requests.
 * This is the same shim, fixture-shaped: it forwards the request to the
 * application with `X-UVH-Edge-Secret` and the internal host, and answers
 * exactly what the application answered. Anything but a GET on that one path
 * is refused here, like the Nginx listener's `limit_except`.
 *
 * Env: EDGE_ASK_SECRET (shared with the application) and UVH_ASK_UPSTREAM
 * (the application origin, `http://app:8000` in the async stack).
 */
$secret = (string) (getenv('EDGE_ASK_SECRET') ?: '');
$upstream = rtrim((string) (getenv('UVH_ASK_UPSTREAM') ?: 'http://app:8000'), '/');
$uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
$path = (string) parse_url($uri, PHP_URL_PATH);
$method = (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET');

header('Cache-Control: no-store');

if ($secret === '' || $method !== 'GET' || $path !== '/internal/caddy/ask') {
    http_response_code(404);
    exit;
}

$query = (string) parse_url($uri, PHP_URL_QUERY);
$handle = curl_init($upstream.'/internal/caddy/ask'.($query !== '' ? '?'.$query : ''));
if ($handle === false) {
    http_response_code(502);
    exit;
}

curl_setopt_array($handle, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 2,
    CURLOPT_TIMEOUT => 5,
    CURLOPT_HTTPHEADER => [
        'Host: internal.uvh',
        'X-UVH-Edge-Secret: '.$secret,
        'X-Forwarded-Proto: http',
    ],
]);

$body = curl_exec($handle);
$status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
curl_close($handle);

http_response_code($status >= 100 ? $status : 502);
if (is_string($body) && $body !== '') {
    echo $body;
}
