<?php

namespace App\Support;

use Illuminate\Support\Arr;
use Illuminate\Support\ConfigurationUrlParser;

/** Inspect mail configuration without constructing a transport or exposing its credentials. */
final class MailTransportPolicy
{
    private const DELIVERY_TRANSPORTS = [
        'smtp', 'sendmail', 'mail', 'ses', 'ses-v2', 'mailgun', 'postmark', 'resend',
    ];

    /**
     * Return the effective delivery leaves, or null when any branch is unsafe.
     * The returned configuration may contain credentials: use it only locally,
     * never in logs or an HTTP response. Resend credentials are checked by the
     * production gate after resolving aliases and composite transports here.
     *
     * @return non-empty-list<array<string, mixed>>|null
     */
    public static function deliveryLeaves(mixed $mail): ?array
    {
        // Laravel's legacy driver overrides the default name whenever it is
        // non-null, even for an empty string. Do not inspect another tree.
        if (! is_array($mail) || isset($mail['driver']) || ! is_string($mail['default'] ?? null)) {
            return null;
        }

        $budget = 64;

        return self::visit($mail['default'], $mail['mailers'] ?? [], [], $budget);
    }

    /** Only a standalone development transport may be simulated without sending. */
    public static function isDevelopment(mixed $mail): bool
    {
        if (! is_array($mail) || isset($mail['driver']) || ! is_string($mail['default'] ?? null)) {
            return false;
        }
        $config = self::resolve($mail['default'], $mail['mailers'] ?? []);

        return $config !== null && in_array($config['transport'] ?? null, ['log', 'array'], true);
    }

    /** @return non-empty-list<array<string, mixed>>|null */
    private static function visit(string $name, mixed $mailers, array $path, int &$budget): ?array
    {
        // Check only the active path for cycles: two healthy branches may share
        // one SMTP leaf. The total budget also bounds a deeply nested DAG.
        if (--$budget < 0 || in_array($name, $path, true)) {
            return null;
        }
        $config = self::resolve($name, $mailers);
        if ($config === null) {
            return null;
        }
        $transport = $config['transport'] ?? null;
        if (in_array($transport, self::DELIVERY_TRANSPORTS, true)) {
            return [$config];
        }
        if (! in_array($transport, ['failover', 'roundrobin'], true)
            || ! is_array($config['mailers'] ?? null) || $config['mailers'] === []) {
            return null;
        }

        $leaves = [];
        foreach ($config['mailers'] as $child) {
            if (! is_string($child)) {
                return null;
            }
            $branch = self::visit($child, $mailers, [...$path, $name], $budget);
            if ($branch === null) {
                return null;
            }
            array_push($leaves, ...$branch);
        }

        return $leaves;
    }

    private static function resolve(string $name, mixed $mailers): ?array
    {
        if ($name === '' || ! is_array($mailers)) {
            return null;
        }
        // Laravel reads "mail.mailers.{name}" as a dotted config path. A
        // literal "group.primary" key must not hide a nested log transport.
        $config = Arr::get(['mailers' => $mailers], 'mailers.'.$name);
        if (! is_array($config)) {
            return null;
        }
        if (isset($config['url'])) {
            try {
                // Match Laravel MailManager::getConfig: MAIL_URL and its query
                // options override the transport field, even for an SMTP alias.
                $config = array_merge($config, (new ConfigurationUrlParser)->parseConfiguration($config));
                $config['transport'] = $config['driver'] ?? null;
            } catch (\Throwable) {
                return null;
            }
        }

        return $config;
    }
}
