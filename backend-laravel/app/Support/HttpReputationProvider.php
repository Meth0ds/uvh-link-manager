<?php

namespace App\Support;

use Illuminate\Support\Carbon;

/**
 * The configured reputation provider, spoken over the contract documented in
 * `docs/url-reputation-runbook.md`:
 *
 *   POST <REPUTATION_PROVIDER_URL>
 *   { "url": "<destination>" }
 *   → 200 { "verdict": "safe" | "suspicious" | "malicious", "score": 0..100,
 *           "expiresAt": "<ISO-8601, optional>" }
 *
 * The request leaves through the same hardened transport as a webhook delivery:
 * every resolved address validated, the validated addresses pinned at connect
 * time, no redirects and a hard timeout. The body is read with a ceiling, and a
 * provider that answers anything this contract does not describe is reported as
 * `unknown` — never as a clean destination.
 */
final class HttpReputationProvider implements ReputationProvider
{
    public const LABEL_FALLBACK = 'external';

    /** @param array{url: string, token: string, timeout_ms: int, max_body_bytes: int, ttl_hours: int} $settings */
    public function __construct(private readonly array $settings) {}

    public function label(): string
    {
        return ExternalEndpoint::label($this->settings['url'], self::LABEL_FALLBACK);
    }

    public function configured(): bool
    {
        return ExternalEndpoint::isSafeHttps(trim($this->settings['url']));
    }

    public function check(string $destination): ReputationVerdict
    {
        if (! $this->configured()) {
            return ReputationVerdict::unknown($this->label(), 'provider_not_configured');
        }

        $payload = json_encode(['url' => $destination], JSON_UNESCAPED_SLASHES);
        if (! is_string($payload)) {
            return ReputationVerdict::unknown($this->label(), 'request_encoding_failed');
        }

        $headers = [
            'Accept: application/json',
            'Content-Type: application/json',
            'User-Agent: uvh-reputation/1',
        ];
        $token = trim($this->settings['token']);
        if ($token !== '') {
            $headers[] = 'Authorization: Bearer '.$token;
        }

        try {
            $response = Ssrf::safeFetchBody(
                trim($this->settings['url']),
                $headers,
                $payload,
                $this->settings['timeout_ms'],
                $this->settings['max_body_bytes'],
            );
        } catch (\Throwable $error) {
            // Auxiliary dependency: an unreachable provider is not evidence
            // about the destination, and must not fail the caller's decision.
            OperationalMetrics::increment('reputation.provider_unavailable');

            return ReputationVerdict::unknown($this->label(), 'provider_unreachable');
        }

        if (! $response['ok']) {
            OperationalMetrics::increment('reputation.provider_unavailable');

            return ReputationVerdict::unknown($this->label(), 'provider_status_'.$response['status']);
        }

        return $this->interpret($response['body']);
    }

    private function interpret(string $body): ReputationVerdict
    {
        $decoded = json_decode($body, true, 8);
        if (! is_array($decoded)) {
            return ReputationVerdict::unknown($this->label(), 'provider_not_json');
        }

        $verdict = $decoded['verdict'] ?? null;
        if (! is_string($verdict) || ! in_array($verdict, [
            ReputationVerdict::SAFE,
            ReputationVerdict::SUSPICIOUS,
            ReputationVerdict::MALICIOUS,
        ], true)) {
            // `unknown` from a provider is accepted as such, but it is not a
            // claim about the destination and never becomes one.
            return ReputationVerdict::unknown($this->label(), 'provider_verdict_unusable');
        }

        $score = $decoded['score'] ?? null;
        $score = is_int($score) || (is_string($score) && ctype_digit($score)) ? (int) $score : null;
        $score = $score === null ? null : max(-32768, min(32767, $score));

        return ReputationVerdict::make(
            $verdict,
            $this->label(),
            now(),
            $this->expiry($decoded['expiresAt'] ?? null),
            $score,
        );
    }

    /**
     * A provider cannot extend its own cache indefinitely: the TTL is bounded by
     * configuration, so a compromised or buggy provider cannot freeze a verdict
     * forever.
     */
    private function expiry(mixed $raw): Carbon
    {
        $ceiling = now()->addHours(max(1, min(24 * 30, $this->settings['ttl_hours'])));
        if (! is_string($raw) || strlen($raw) > 64) {
            return $ceiling;
        }

        try {
            $parsed = Carbon::parse($raw);
        } catch (\Throwable) {
            return $ceiling;
        }

        return $parsed->lessThan(now()->addMinutes(5)) || $parsed->greaterThan($ceiling) ? $ceiling : $parsed;
    }
}
