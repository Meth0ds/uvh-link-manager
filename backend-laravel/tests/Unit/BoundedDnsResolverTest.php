<?php

namespace Tests\Unit;

use App\Support\BoundedDnsResolver;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Process\Process;

final class BoundedDnsResolverTest extends TestCase
{
    private function resolver(string $script): BoundedDnsResolver
    {
        return new class($script) extends BoundedDnsResolver
        {
            public ?Process $child = null;

            public function __construct(private readonly string $script) {}

            protected function process(string $host): Process
            {
                return $this->child = new Process([PHP_BINARY, '-r', $this->script]);
            }
        };
    }

    public function test_slow_dns_is_terminated_and_reaped_within_the_network_budget(): void
    {
        $resolver = $this->resolver('usleep(5000000); echo "[]";');
        $started = microtime(true);
        try {
            $resolver->resolve('example.org', 100);
            $this->fail('A stalled DNS child must time out.');
        } catch (\RuntimeException $error) {
            $this->assertSame('inspection_timeout', $error->getMessage());
        }
        $this->assertLessThan(1.0, microtime(true) - $started);
        $this->assertFalse($resolver->child->isRunning());
    }

    public function test_all_ipv4_and_ipv6_answers_are_preserved_for_ssrf_validation(): void
    {
        $records = [['ip' => '93.184.216.34'], ['ipv6' => '2606:4700:4700::1111'], ['ip' => '127.0.0.1']];
        $resolver = $this->resolver('echo '.var_export(json_encode($records, JSON_THROW_ON_ERROR), true).';');
        $this->assertSame($records, $resolver->resolve('example.org', 2000));
    }

    public function test_excessive_output_terminates_the_child_without_waiting_for_its_exit(): void
    {
        $resolver = $this->resolver('echo str_repeat("a", 1000000); usleep(5000000);');
        $started = microtime(true);
        try {
            $resolver->resolve('example.org', 2000);
            $this->fail('An oversized DNS reply must be rejected.');
        } catch (\RuntimeException $error) {
            $this->assertSame('SSRF: no se pudo resolver el host', $error->getMessage());
        }
        $this->assertLessThan(1.0, microtime(true) - $started);
        $this->assertFalse($resolver->child->isRunning());
    }

    public function test_failed_dns_never_exposes_process_diagnostics(): void
    {
        $resolver = $this->resolver('fwrite(STDERR, "private-host.example secret"); exit(1);');
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('SSRF: no se pudo resolver el host');
        $resolver->resolve('example.org', 2000);
    }

    public function test_malformed_or_excessive_dns_answers_fail_closed(): void
    {
        foreach (['invalid-json', '{"ip":"127.0.0.1"}', '[{"ip":"not-an-ip"}]', json_encode(array_fill(0, 257, ['ip' => '93.184.216.34']))] as $output) {
            try {
                $this->resolver('echo '.var_export($output, true).';')->resolve('example.org', 2000);
                $this->fail('Invalid DNS output must be rejected.');
            } catch (\RuntimeException $error) {
                $this->assertSame('SSRF: no se pudo resolver el host', $error->getMessage());
            }
        }
    }
}
