<?php

namespace App\Support {
    // Isolated process only: never replace production DNS/curl functions in the
    // PHPUnit worker. Exercise the actual option builder and stream callbacks.
    function dns_get_record(string $host, int $type): array
    {
        $GLOBALS['dns_calls']++;
        if ($GLOBALS['scenario'] === 'mixed') {
            return [['ip' => '93.184.216.34'], ['ip' => '127.0.0.1']];
        }
        if ($GLOBALS['scenario'] === 'transition') {
            return [['ipv6' => '64:ff9b::a00:1']];
        }
        usleep(1000);

        return [['ip' => '93.184.216.34'], ['ipv6' => '2606:4700:4700::1111']];
    }
    // Supply deterministic records for the option-builder probe. The resolver's
    // actual child process and deadline have their own integration tests.
    class BoundedDnsResolver
    {
        public function resolve(string $host, int $timeoutMs): array
        {
            return dns_get_record($host, DNS_A | DNS_AAAA);
        }
    }
    function curl_init(): object
    {
        $GLOBALS['curl_calls']++;

        return new \stdClass;
    }
    function curl_setopt_array(object $handle, array $options): bool
    {
        $GLOBALS['options'] = $options;

        return true;
    }
    function curl_exec(object $handle): bool
    {
        $options = $GLOBALS['options'];
        if (isset($options[CURLOPT_HEADERFUNCTION])) {
            $header = $GLOBALS['scenario'] === 'headers' ? 'Location: '.str_repeat('x', 17000)."\r\n" : "Content-Type: text/html\r\n";
            if ($options[CURLOPT_HEADERFUNCTION]($handle, $header) === 0) {
                return false;
            }
        }
        if ($options[CURLOPT_NOBODY] ?? false) {
            return true;
        }
        $bytes = str_repeat('a', 2000);

        return strlen($bytes) === $options[CURLOPT_WRITEFUNCTION]($handle, $bytes);
    }
    function curl_getinfo(object $handle, int $option): int
    {
        return 200;
    }
    function curl_close(object $handle): void {}
}

namespace {
    use App\Support\Ssrf;

    require dirname(__DIR__, 2).'/vendor/autoload.php';
    $GLOBALS['dns_calls'] = 0;
    $GLOBALS['curl_calls'] = 0;
    $GLOBALS['scenario'] = 'mixed';
    $checks = [];
    foreach (['mixed', 'transition'] as $scenario) {
        $GLOBALS['scenario'] = $scenario;
        try {
            Ssrf::safeRead('https://example.org/private?token=secret', 'GET', 1000, 1024);
            $checks[$scenario] = false;
        } catch (RuntimeException $error) {
            $checks[$scenario] = str_contains($error->getMessage(), 'interno') && $GLOBALS['curl_calls'] === 0;
        }
    }
    $GLOBALS['scenario'] = 'body';
    $GLOBALS['dns_calls'] = 0;
    $response = Ssrf::safeRead('https://example.org/private?token=secret', 'GET', 1000, 1024);
    $options = $GLOBALS['options'];
    $checks['bounded_body'] = $response['truncated'] && strlen($response['body']) === 1024;
    $checks['one_dns_resolution'] = $GLOBALS['dns_calls'] === 1;
    $checks['pinned_addresses'] = $options[CURLOPT_RESOLVE] === ['example.org:443:93.184.216.34,[2606:4700:4700::1111]'];
    $checks['no_redirect_or_proxy'] = $options[CURLOPT_FOLLOWLOCATION] === false && $options[CURLOPT_MAXREDIRS] === 0 && $options[CURLOPT_PROXY] === '' && $options[CURLOPT_NOPROXY] === '*';
    $checks['verified_tls'] = $options[CURLOPT_SSL_VERIFYPEER] === true && $options[CURLOPT_SSL_VERIFYHOST] === 2;
    $checks['read_only'] = $options[CURLOPT_POST] === false && ! isset($options[CURLOPT_POSTFIELDS]);
    $checks['exact_deadline'] = $options[CURLOPT_TIMEOUT_MS] < 1000 && $options[CURLOPT_TIMEOUT_MS] > 0;
    $checks['no_ambient_credentials'] = ! isset($options[CURLOPT_USERPWD]) && ! isset($options[CURLOPT_COOKIE]) && ! isset($options[CURLOPT_COOKIEJAR]);
    $response = Ssrf::safeRead('https://example.org', 'HEAD', 1000, 1024);
    $checks['head_no_body'] = $response['body'] === '' && $GLOBALS['options'][CURLOPT_NOBODY] === true;
    $GLOBALS['scenario'] = 'headers';
    try {
        Ssrf::safeRead('https://example.org/private?token=secret', 'GET', 1000, 1024);
        $checks['bounded_headers'] = false;
    } catch (RuntimeException $error) {
        $checks['bounded_headers'] = $error->getMessage() === 'inspection_network';
    }
    echo json_encode($checks, JSON_THROW_ON_ERROR);
    exit(in_array(false, $checks, true) ? 1 : 0);
}
