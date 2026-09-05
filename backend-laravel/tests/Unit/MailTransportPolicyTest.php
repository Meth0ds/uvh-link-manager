<?php

namespace Tests\Unit;

use App\Support\MailTransportPolicy;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class MailTransportPolicyTest extends TestCase
{
    #[DataProvider('unsafeMailers')]
    public function test_rejects_every_non_delivering_or_unresolvable_branch(array $mail): void
    {
        $this->assertNull(MailTransportPolicy::deliveryLeaves($mail));
    }

    public static function unsafeMailers(): array
    {
        $smtp = ['transport' => 'smtp'];
        $log = ['transport' => 'log'];

        return [
            'renamed log' => [['default' => 'primary', 'mailers' => ['primary' => $log]]],
            'dotted alias follows Laravel config lookup' => [['default' => 'group.primary', 'mailers' => [
                'group.primary' => $smtp,
                'group' => ['primary' => $log],
            ]]],
            'smtp with log fallback' => [['default' => 'failover', 'mailers' => [
                'failover' => ['transport' => 'failover', 'mailers' => ['smtp', 'log']],
                'smtp' => $smtp, 'log' => $log,
            ]]],
            'nested array fallback' => [['default' => 'primary', 'mailers' => [
                'primary' => ['transport' => 'roundrobin', 'mailers' => ['smtp', 'backup']],
                'backup' => ['transport' => 'failover', 'mailers' => ['memory']],
                'smtp' => $smtp, 'memory' => ['transport' => 'array'],
            ]]],
            'cycle' => [['default' => 'a', 'mailers' => [
                'a' => ['transport' => 'failover', 'mailers' => ['b']],
                'b' => ['transport' => 'roundrobin', 'mailers' => ['a']],
            ]]],
            'unknown alias' => [['default' => 'missing', 'mailers' => ['smtp' => $smtp]]],
            'empty composite' => [['default' => 'empty', 'mailers' => [
                'empty' => ['transport' => 'failover', 'mailers' => []],
            ]]],
            'unknown transport' => [['default' => 'primary', 'mailers' => [
                'primary' => ['transport' => 'custom-unreviewed'],
            ]]],
            'url overrides smtp with log' => [['default' => 'primary', 'mailers' => [
                'primary' => ['transport' => 'smtp', 'url' => 'log://localhost'],
            ]]],
            'url query overrides driver' => [['default' => 'primary', 'mailers' => [
                'primary' => ['transport' => 'smtp', 'url' => 'smtp://localhost?driver=log'],
            ]]],
            'legacy driver takes precedence in Laravel' => [[
                'driver' => 'log', 'default' => 'smtp', 'mailers' => ['smtp' => $smtp],
            ]],
            'empty legacy driver is not a modern configuration' => [[
                'driver' => '', 'default' => 'smtp', 'mailers' => ['smtp' => $smtp],
            ]],
        ];
    }

    public function test_accepts_nested_delivery_providers_with_a_shared_leaf(): void
    {
        $mail = ['default' => 'primary', 'mailers' => [
            'primary' => ['transport' => 'failover', 'mailers' => ['smtp', 'backup']],
            'smtp' => ['transport' => 'smtp', 'url' => 'smtp://localhost:2525'],
            'backup' => ['transport' => 'roundrobin', 'mailers' => ['smtp', 'api']],
            'api' => ['transport' => 'resend', 'key' => 'fixture-key'],
        ]];

        $leaves = MailTransportPolicy::deliveryLeaves($mail);
        $this->assertNotNull($leaves);
        $this->assertSame(['smtp', 'smtp', 'resend'], array_column($leaves, 'transport'));
        $this->assertSame('fixture-key', $leaves[2]['key']);
        $this->assertFalse(MailTransportPolicy::isDevelopment($mail));
    }

    public function test_development_simulation_is_limited_to_a_standalone_transport(): void
    {
        $mail = ['default' => 'preview', 'mailers' => ['preview' => ['transport' => 'log']]];
        $this->assertTrue(MailTransportPolicy::isDevelopment($mail));

        $mail['mailers']['wrapper'] = ['transport' => 'failover', 'mailers' => ['preview']];
        $mail['default'] = 'wrapper';
        $this->assertFalse(MailTransportPolicy::isDevelopment($mail));
    }

    public function test_configuration_traversal_is_bounded_even_without_a_cycle(): void
    {
        $mailers = ['leaf' => ['transport' => 'smtp']];
        $next = 'leaf';
        for ($index = 0; $index < 65; $index++) {
            $name = 'layer-'.$index;
            $mailers[$name] = ['transport' => 'failover', 'mailers' => [$next]];
            $next = $name;
        }

        $this->assertNull(MailTransportPolicy::deliveryLeaves(['default' => $next, 'mailers' => $mailers]));
    }
}
