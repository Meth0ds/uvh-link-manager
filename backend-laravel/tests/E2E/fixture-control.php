<?php

declare(strict_types=1);

/**
 * HTTP control surface for the async E2E fixtures.
 *
 * The sink processes never restart between scenarios: the driver rewrites
 * their state file and every following operation re-reads it. Keeping the
 * control surface as plain HTTP means the Node driver needs no `docker exec`
 * and cannot race a fixture that is mid-conversation.
 *
 * Endpoints:
 *   GET  /__state  -> current state (empty object when unset)
 *   POST /__state  -> replace state with a JSON object
 *   GET  /__files  -> file names inside the state directory (?dir=)
 *   GET  /__file   -> raw content of one state file (?name=)
 *
 * The target file comes from UVH_FIXTURE_STATE so several fixtures can share
 * one writable volume without clobbering each other's keys.
 */
$stateFile = (string) (getenv('UVH_FIXTURE_STATE') ?: '/state/fixture.json');
$stateDir = dirname($stateFile);
$path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$method = (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET');

/** Resolve a caller-supplied relative path inside the state directory. */
$resolve = static function (string $relative) use ($stateDir): ?string {
    $relative = str_replace('\\', '/', $relative);
    if ($relative === '' || str_contains($relative, '..') || str_starts_with($relative, '/')) {
        return null;
    }
    $absolute = realpath($stateDir.'/'.$relative);
    $root = realpath($stateDir);
    if ($absolute === false || $root === false || ! str_starts_with($absolute, $root.DIRECTORY_SEPARATOR)) {
        return null;
    }

    return $absolute;
};

if ($path === '/__files' && $method === 'GET') {
    header('Content-Type: application/json');
    $dir = $resolve((string) ($_GET['dir'] ?? '.'));
    if ($dir === null || ! is_dir($dir)) {
        http_response_code(404);
        echo json_encode(['error' => 'unknown directory']);
        exit;
    }
    $names = array_values(array_diff(scandir($dir) ?: [], ['.', '..']));
    sort($names);
    echo json_encode(['dir' => (string) ($_GET['dir'] ?? '.'), 'files' => $names]);
    exit;
}

if ($path === '/__file' && $method === 'GET') {
    $file = $resolve((string) ($_GET['name'] ?? ''));
    if ($file === null || ! is_file($file)) {
        http_response_code(404);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'unknown file']);
        exit;
    }
    header('Content-Type: text/plain; charset=utf-8');
    echo (string) file_get_contents($file);
    exit;
}

header('Content-Type: application/json');

$read = static function () use ($stateFile): array {
    $raw = @file_get_contents($stateFile);
    $decoded = is_string($raw) ? json_decode($raw, true) : null;

    return is_array($decoded) ? $decoded : [];
};

if ($path === '/__state' && $method === 'GET') {
    echo json_encode($read(), JSON_THROW_ON_ERROR);
    exit;
}

if ($path === '/__state' && $method === 'POST') {
    $decoded = json_decode((string) file_get_contents('php://input'), true);
    if (! is_array($decoded)) {
        http_response_code(400);
        echo json_encode(['error' => 'state must be a JSON object'], JSON_THROW_ON_ERROR);
        exit;
    }
    $payload = json_encode($decoded, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    if (@file_put_contents($stateFile.'.tmp', $payload) === false
        || ! @rename($stateFile.'.tmp', $stateFile)) {
        http_response_code(500);
        echo json_encode(['error' => 'state file is not writable'], JSON_THROW_ON_ERROR);
        exit;
    }
    echo json_encode(['ok' => true, 'state' => $decoded], JSON_THROW_ON_ERROR);
    exit;
}

http_response_code(404);
echo json_encode(['error' => 'unknown control endpoint'], JSON_THROW_ON_ERROR);
