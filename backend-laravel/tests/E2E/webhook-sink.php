<?php

declare(strict_types=1);

/**
 * Scriptable webhook receiver for the async E2E stack.
 *
 * `WebhookService` delivers through `Ssrf::safeFetch`, which refuses every
 * private, loopback and link-local address by design. The receiver therefore
 * lives on a fixture subnet that looks routable (`11.0.0.0/24`) while the
 * scenario still controls it completely. Weakening the SSRF guard so that a
 * test could reach a 172.x address would be the wrong trade.
 *
 * One HTTP port serves both the delivery endpoint and the control surface:
 *   POST /hook       -> records the request and replies according to state
 *   GET  /__state    -> current state
 *   POST /__state    -> replace state, e.g. {"failures": 2, "status": 200}
 *   GET  /__received -> every request the worker has delivered so far
 *   POST /__reset    -> forget state and received requests
 *
 * State lives on disk because `php -S` re-runs this script for every request;
 * the server is single threaded, so read-modify-write needs no locking.
 */
$stateFile = (string) (getenv('UVH_FIXTURE_STATE') ?: '/state/webhook.json');
$receivedFile = dirname($stateFile).'/webhook-received.jsonl';
@mkdir(dirname($stateFile), 0777, true);

$readState = static function () use ($stateFile): array {
    $raw = @file_get_contents($stateFile);
    $decoded = is_string($raw) ? json_decode($raw, true) : null;

    return is_array($decoded) ? $decoded : [];
};

$writeState = static function (array $state) use ($stateFile): void {
    @file_put_contents($stateFile.'.tmp', json_encode($state, JSON_UNESCAPED_SLASHES));
    @rename($stateFile.'.tmp', $stateFile);
};

$path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$method = (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET');

if ($path === '/__reset') {
    @unlink($stateFile);
    @unlink($receivedFile);
    header('Content-Type: application/json');
    echo json_encode(['ok' => true]);
    exit;
}

if ($path === '/__state') {
    header('Content-Type: application/json');
    if ($method === 'POST') {
        $decoded = json_decode((string) file_get_contents('php://input'), true);
        if (! is_array($decoded)) {
            http_response_code(400);
            echo json_encode(['error' => 'state must be a JSON object']);
            exit;
        }
        $writeState($decoded);
        echo json_encode(['ok' => true, 'state' => $decoded]);
        exit;
    }
    echo json_encode($readState());
    exit;
}

if ($path === '/__received') {
    header('Content-Type: application/json');
    $entries = [];
    $raw = @file_get_contents($receivedFile);
    foreach (explode("\n", is_string($raw) ? $raw : '') as $line) {
        if ($line === '') {
            continue;
        }
        $decoded = json_decode($line, true);
        if (is_array($decoded)) {
            $entries[] = $decoded;
        }
    }
    echo json_encode($entries);
    exit;
}

if ($path !== '/hook') {
    http_response_code(404);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'unknown endpoint']);
    exit;
}

$headers = [];
foreach ($_SERVER as $key => $value) {
    if (str_starts_with((string) $key, 'HTTP_')) {
        $headers[strtolower(str_replace('_', '-', substr((string) $key, 5)))] = (string) $value;
    }
}
$body = (string) file_get_contents('php://input');

$state = $readState();
$failures = max(0, (int) ($state['failures'] ?? 0));
$failStatus = max(400, (int) ($state['failStatus'] ?? 500));
$okStatus = (int) ($state['status'] ?? 200);

$reject = $failures > 0;
if ($reject) {
    $state['failures'] = $failures - 1;
    $writeState($state);
}
$status = $reject ? $failStatus : $okStatus;

@file_put_contents($receivedFile, json_encode([
    'path' => $path,
    'headers' => $headers,
    'body' => $body,
    'responded' => $status,
    'at' => microtime(true),
], JSON_UNESCAPED_SLASHES)."\n", FILE_APPEND);

http_response_code($status);
header('Content-Type: application/json');
echo json_encode(['received' => true, 'status' => $status]);
