<?php

declare(strict_types=1);

// This process is reachable only from the isolated Compose network. It models
// the narrow hCaptcha siteverify contract so browser tests never depend on an
// external anti-abuse provider or reuse production credentials.
header('Content-Type: application/json');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || ($_SERVER['REQUEST_URI'] ?? '') !== '/siteverify') {
    http_response_code(404);
    echo json_encode(['success' => false], JSON_THROW_ON_ERROR);
    exit;
}

parse_str((string) file_get_contents('php://input'), $form);
$expectedSecret = (string) ($_ENV['HCAPTCHA_E2E_SECRET'] ?? getenv('HCAPTCHA_E2E_SECRET') ?: '');
$secret = is_string($form['secret'] ?? null) ? $form['secret'] : '';
$siteKey = is_string($form['sitekey'] ?? null) ? $form['sitekey'] : '';
$response = is_string($form['response'] ?? null) ? $form['response'] : '';
$valid = $expectedSecret !== ''
    && hash_equals($expectedSecret, $secret)
    && hash_equals('10000000-ffff-ffff-ffff-000000000001', $siteKey)
    && str_starts_with($response, 'uvh-e2e-pass-');

echo json_encode($valid
    ? ['success' => true, 'hostname' => 'dummy-key-pass']
    : ['success' => false, 'error-codes' => ['invalid-input-response']], JSON_THROW_ON_ERROR);
