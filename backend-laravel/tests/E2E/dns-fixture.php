<?php

declare(strict_types=1);

/**
 * Authoritative DNS fixture for the async E2E stack.
 *
 * `VerifyDomainDnsJob` proves ownership with a TXT record and routing with a
 * CNAME record, both read through `dns_get_record`. A deterministic success
 * transition therefore needs a resolver the scenario controls, and a
 * deterministic failure needs a name that is authoritatively absent.
 *
 * This responder owns the `.e2e.uvh` TLD and forwards every other query to
 * the upstream resolver (Docker's embedded DNS by default), so the same
 * container network keeps resolving `postgres`, `mail-sink` and friends.
 * Containers that must use it declare `dns: [<fixture address>]`.
 *
 * State (see fixture-control.php) is a zone document:
 *   {"txt": {"_uvh-verification.alfa.e2e.uvh": "token"},
 *    "cname": {"alfa.e2e.uvh": "edge.e2e.uvh"},
 *    "nxdomain": ["gone.e2e.uvh"]}
 *
 * A name inside the zone with no matching record answers NOERROR/0 answers
 * (NODATA), which is what a real domain that simply lacks the TXT looks like.
 * That distinction matters: NXDOMAIN makes libresolv report a resolver error,
 * while NODATA lets the job record the honest `ownership_and_routing_missing`.
 */
$stateFile = (string) (getenv('UVH_FIXTURE_STATE') ?: '/state/dns.json');
$zone = (string) (getenv('UVH_DNS_ZONE') ?: 'e2e.uvh');
$upstream = (string) (getenv('UVH_DNS_UPSTREAM') ?: '127.0.0.11:53');
$port = (int) (getenv('UVH_DNS_PORT') ?: 53);

$state = static function () use ($stateFile): array {
    $raw = @file_get_contents($stateFile);
    $decoded = is_string($raw) ? json_decode($raw, true) : null;

    return is_array($decoded) ? $decoded : [];
};

$encodeName = static function (string $name): string {
    $out = '';
    foreach (explode('.', trim($name, '.')) as $label) {
        if ($label === '') {
            continue;
        }
        $out .= chr(strlen($label)).$label;
    }

    return $out."\x00";
};

/** @return array{0: string, 1: int} */
$decodeName = static function (string $packet, int $offset): array {
    $labels = [];
    $guard = 0;
    while (isset($packet[$offset]) && $guard < 64) {
        $guard++;
        $length = ord($packet[$offset]);
        if ($length === 0) {
            $offset++;

            break;
        }
        if (($length & 0xC0) === 0xC0) {
            $pointer = ((($length & 0x3F) << 8) | ord((string) $packet[$offset + 1]));
            $offset += 2;
            [$pointed] = $decodeName($packet, $pointer);
            $labels[] = $pointed;

            break;
        }
        $labels[] = substr($packet, $offset + 1, $length);
        $offset += 1 + $length;
    }

    return [implode('.', array_filter($labels, static fn ($l) => $l !== '')), $offset];
};

$authoritative = static function (string $name) use ($zone): bool {
    $name = strtolower(rtrim($name, '.'));

    return $name === $zone || str_ends_with($name, '.'.$zone);
};

$response = static function (
    string $id,
    int $flags,
    string $question,
    array $records,
): string {
    $count = count($records);
    $answers = implode('', $records);

    return $id.pack('n', $flags).pack('n', 1).pack('n', $count).pack('n', 0).pack('n', 0).$question.$answers;
};

$rr = static function (int $type, string $rdata): string {
    return "\xC0\x0C".pack('n', $type).pack('n', 1).pack('N', 30).pack('n', strlen($rdata)).$rdata;
};

$server = @stream_socket_server('udp://0.0.0.0:'.$port, $errno, $errstr, STREAM_SERVER_BIND);
if ($server === false) {
    fwrite(STDERR, "dns-fixture: cannot bind {$port}: {$errstr}\n");
    exit(1);
}
fwrite(STDOUT, "dns-fixture authoritative for {$zone}, upstream {$upstream}\n");

while (true) {
    $peer = '';
    $packet = @stream_socket_recvfrom($server, 1500, 0, $peer);
    if (! is_string($packet) || strlen($packet) < 13) {
        continue;
    }

    $id = substr($packet, 0, 2);
    $questionCount = unpack('n', substr($packet, 4, 2))[1] ?? 0;
    if ($questionCount !== 1) {
        continue;
    }

    [$name, $offset] = $decodeName($packet, 12);
    $qtype = unpack('n', substr($packet, $offset, 2))[1] ?? 0;
    $question = substr($packet, 12, $offset + 4 - 12);
    $lower = strtolower($name);

    if (! $authoritative($lower)) {
        $socket = @stream_socket_client('udp://'.$upstream, $code, $message, 2);
        if ($socket === false) {
            @stream_socket_sendto($server, $response($id, 0x8182, $question, []), 0, $peer);

            continue;
        }
        stream_set_timeout($socket, 2);
        @fwrite($socket, $packet);
        $reply = @fread($socket, 1500);
        @fclose($socket);
        if (is_string($reply) && $reply !== '') {
            @stream_socket_sendto($server, $reply, 0, $peer);
        } else {
            @stream_socket_sendto($server, $response($id, 0x8182, $question, []), 0, $peer);
        }

        continue;
    }

    $zoneState = $state();
    $records = [];
    if ($qtype === 16) { // TXT
        $value = $zoneState['txt'][$lower] ?? null;
        if (is_string($value) && $value !== '') {
            $records[] = $rr(16, chr(strlen($value)).$value);
        }
    } elseif ($qtype === 5) { // CNAME
        $target = $zoneState['cname'][$lower] ?? null;
        if (is_string($target) && $target !== '') {
            $records[] = $rr(5, $encodeName($target));
        }
    }

    $nxdomain = in_array($lower, $zoneState['nxdomain'] ?? [], true);
    $flags = $nxdomain ? 0x8183 : 0x8180;

    @stream_socket_sendto($server, $response($id, $flags, $question, $records), 0, $peer);
}
