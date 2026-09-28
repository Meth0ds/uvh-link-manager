<?php

declare(strict_types=1);

/**
 * Assemble the TLS trust file the platform's probes verify with.
 *
 * Pebble issues from a CA hierarchy it generates on every start, so the
 * anchors are runtime facts, not fixtures: its management API serves them at
 * `/roots/<n>` and `/intermediates/<n>`. This script fetches both — the
 * management API's own certificate is verified against the static Mini CA
 * that signs it — and writes one bundle the workers' probes and the visitor
 * checks point at. The intermediate is an anchor on purpose: whether the edge
 * sends it in the chain or not, the chain always builds to the root.
 *
 * Runs before the ask shim starts serving, inside the fixture container that
 * mounts the Mini CA read-only and the trust directory read-write. A Pebble
 * that is not up yet is waited for, not failed: this is stack bring-up.
 */
$management = rtrim((string) (getenv('UVH_PEBBLE_MANAGEMENT') ?: 'https://pebble:15000'), '/');
$miniCa = (string) (getenv('UVH_PEBBLE_MINICA') ?: '/certs/pebble.minica.pem');
$target = (string) (getenv('UVH_TLS_TRUST_FILE') ?: '/usr/local/share/uvh/pebble-ca.pem');

$fetch = static function (string $url) use ($miniCa): ?string {
    $handle = curl_init($url);
    if ($handle === false) {
        return null;
    }
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 2,
        CURLOPT_TIMEOUT => 5,
        // The management certificate is minted for `localhost` (it is Pebble's
        // own API fixture), so trust is proven against the Mini CA while the
        // name check stays off: the URL is harness configuration.
        CURLOPT_CAINFO => $miniCa,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 0,
    ]);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);

    return is_string($body) && $status === 200 && str_contains($body, 'BEGIN CERTIFICATE') ? $body : null;
};

$anchors = null;
for ($attempt = 0; $attempt < 30; $attempt++) {
    $collected = [];
    foreach (['/roots/', '/intermediates/'] as $prefix) {
        for ($index = 0; $index < 4; $index++) {
            $pem = $fetch($management.$prefix.$index);
            if ($pem === null) {
                break;
            }
            $collected[] = trim($pem);
        }
    }
    if ($collected !== []) {
        $anchors = $collected;
        break;
    }
    sleep(2);
}

if ($anchors === null) {
    fwrite(STDERR, "pebble-ca-trust: the management API never served anchors\n");
    exit(1);
}

if (@file_put_contents($target, implode("\n", $anchors)."\n") === false) {
    fwrite(STDERR, "pebble-ca-trust: cannot write {$target}\n");
    exit(1);
}

echo 'pebble-ca-trust: '.count($anchors)." anchor(s) -> {$target}\n";
