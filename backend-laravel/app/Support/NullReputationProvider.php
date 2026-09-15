<?php

namespace App\Support;

/**
 * The default adapter: no provider is configured.
 *
 * It answers `unknown` for everything, on purpose. The tempting alternative —
 * treating "no provider" as "nothing suspicious found" — is how a deployment
 * with no reputation coverage ends up telling its users that a phishing URL is
 * clean.
 */
final class NullReputationProvider implements ReputationProvider
{
    public const LABEL = 'none';

    public function label(): string
    {
        return self::LABEL;
    }

    public function configured(): bool
    {
        return false;
    }

    public function check(string $destination): ReputationVerdict
    {
        return ReputationVerdict::unknown(self::LABEL, 'provider_not_configured');
    }
}
