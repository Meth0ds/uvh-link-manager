<?php

namespace App\Support;

use Symfony\Component\Process\Exception\ProcessTimedOutException;
use Symfony\Component\Process\Process;

/** Native DNS can block beyond curl's timeout; isolate it under the same deadline. */
class BoundedDnsResolver
{
    /** @return array<int, array<string, string>> */
    public function resolve(string $host, int $timeoutMs): array
    {
        if ($timeoutMs <= 0) {
            throw new \RuntimeException('inspection_timeout');
        }
        $process = $this->process($host);
        $process->setTimeout($timeoutMs / 1000);
        $output = '';
        $oversized = false;
        try {
            $process->start(static function (string $type, string $bytes) use (&$output, &$oversized, $process): void {
                // Never retain diagnostics, which can contain sensitive hosts.
                if ($type === Process::OUT) {
                    if (strlen($output) + strlen($bytes) > 65536) {
                        $oversized = true;
                    } elseif (! $oversized) {
                        $output .= $bytes;
                    }
                    $process->clearOutput();
                } else {
                    $process->clearErrorOutput();
                }
            });
            while ($process->isRunning()) {
                if ($oversized) {
                    throw new \RuntimeException('SSRF: no se pudo resolver el host');
                }
                $process->checkTimeout();
                usleep(1000);
            }
            if ($oversized || ! $process->isSuccessful()) {
                throw new \RuntimeException('SSRF: no se pudo resolver el host');
            }
            $records = json_decode($output, true, 4, JSON_THROW_ON_ERROR);
            if (! is_array($records) || ! array_is_list($records) || count($records) > 256) {
                throw new \RuntimeException('SSRF: no se pudo resolver el host');
            }
            foreach ($records as $record) {
                if (! is_array($record) || count($record) !== 1
                    || (! isset($record['ip']) && ! isset($record['ipv6']))
                    || ! is_string($record['ip'] ?? $record['ipv6'] ?? null)
                    || filter_var($record['ip'] ?? $record['ipv6'], FILTER_VALIDATE_IP) === false) {
                    throw new \RuntimeException('SSRF: no se pudo resolver el host');
                }
            }

            return $records;
        } catch (ProcessTimedOutException) {
            throw new \RuntimeException('inspection_timeout');
        } catch (\JsonException) {
            throw new \RuntimeException('SSRF: no se pudo resolver el host');
        } finally {
            // Also reap the child if a callback or parser fails. No worker remains
            // waiting for the operating system's independent resolver retries.
            if ($process->isRunning()) {
                $process->stop(0);
            }
        }
    }

    protected function process(string $host): Process
    {
        // Array arguments avoid a shell; neither a URL nor credentials enter the
        // child. No framework boot, external resources or Composer code is loaded.
        return new Process([PHP_BINARY, '-d', 'memory_limit=32M', '-r', <<<'PHP'
            $records = @dns_get_record($argv[1], DNS_A | DNS_AAAA);
            if (!is_array($records) || count($records) > 256) { exit(1); }
            $addresses = [];
            foreach ($records as $record) {
                if (isset($record['ip'])) { $addresses[] = ['ip' => $record['ip']]; }
                elseif (isset($record['ipv6'])) { $addresses[] = ['ipv6' => $record['ipv6']]; }
            }
            echo json_encode($addresses, JSON_THROW_ON_ERROR);
            PHP, $host]);
    }
}
