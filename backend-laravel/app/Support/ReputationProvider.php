<?php

namespace App\Support;

/**
 * Optional destination-reputation provider.
 *
 * The adapter exists so the integration has one place to live and one contract
 * to satisfy; it is *not* an admission requirement for the product. Nothing in
 * the redirect path calls it, blocking never depends on it, and a deployment
 * without a provider reports the capability as unavailable instead of inventing
 * a verdict.
 */
interface ReputationProvider
{
    /** Stable label stored with each verdict; never a URL or a secret. */
    public function label(): string;

    /** Whether this adapter is configured well enough to be asked anything. */
    public function configured(): bool;

    /**
     * Ask about one destination. Implementations must not throw: an unreachable
     * or malformed provider answers `unknown` with an error label, because a
     * failed lookup is not evidence about the destination.
     */
    public function check(string $destination): ReputationVerdict;
}
