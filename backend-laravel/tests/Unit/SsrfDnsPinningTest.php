<?php

namespace Tests\Unit;

use App\Support\Ssrf;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;
use Symfony\Component\Process\Process;

final class SsrfDnsPinningTest extends TestCase
{
    public function test_curl_keeps_all_pinned_addresses_instead_of_overwriting_a_reachable_one(): void
    {
        // Loopback is used only to test curl's address list, after validation.
        // Public transport still refuses every private address before this step.
        $server = new Process([PHP_BINARY, '-r', <<<'PHP'
            $socket = stream_socket_server('tcp://127.0.0.1:0');
            if (!$socket) { exit(1); }
            echo substr(strrchr(stream_socket_get_name($socket, false), ':'), 1)."\n";
            fflush(STDOUT);
            $client = stream_socket_accept($socket, 3);
            if (!$client) { exit(2); }
            while (($line = fgets($client)) !== false && trim($line) !== '') {}
            fwrite($client, "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
            fclose($client);
            fclose($socket);
            PHP]);
        $server->start();
        try {
            $deadline = microtime(true) + 2;
            do {
                $output = trim($server->getOutput());
                if (ctype_digit($output)) {
                    break;
                }
                usleep(1000);
            } while ($server->isRunning() && microtime(true) < $deadline);
            $this->assertTrue(ctype_digit($output), 'The isolated HTTP fixture must listen.');
            $options = (new ReflectionMethod(Ssrf::class, 'hardenedOptions'))->invoke(null, [
                'scheme' => 'http', 'host' => 'pinned.example', 'port' => (int) $output,
                'path' => '/', 'ips' => ['127.0.0.1', '127.0.0.2'],
            ], [], '', 1000);
            $curl = curl_init();
            try {
                curl_setopt_array($curl, $options);
                $body = curl_exec($curl);
                $this->assertSame(200, curl_getinfo($curl, CURLINFO_RESPONSE_CODE));
                $this->assertSame('ok', $body);
            } finally {
                curl_close($curl);
            }
        } finally {
            $server->stop(0);
        }
    }
}
