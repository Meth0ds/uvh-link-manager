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

    /**
     * Shortest window a provider's own expiry can ask for.
     *
     * Without a floor, `expiresAt: now` would mean a fresh lookup on every
     * evaluation, which turns a provider's "ask me again soon" into load. Five
     * minutes is short enough to honour the intent and long enough not to hammer
     * a third party.
     */
    private const MIN_TTL_MINUTES = 5;

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

        // The comparison is case-insensitive and trimmed. A provider answering
        // `"MALICIOUS"` — a serialisation change on their side, a proxy adding
        // strtoupper, a hand-written integration — used to be degraded to
        // `unknown` in silence, which is the one outcome that turns the auto
        // block off without anybody being told: the only path that withdraws
        // abusive links stopped firing and nothing pointed at why.
        $verdict = is_string($decoded['verdict'] ?? null) ? strtolower(trim($decoded['verdict'])) : null;
        if ($verdict === null || ! in_array($verdict, [
            ReputationVerdict::SAFE,
            ReputationVerdict::SUSPICIOUS,
            ReputationVerdict::MALICIOUS,
        ], true)) {
            // `unknown` from a provider is accepted as such, but it is not a
            // claim about the destination and never becomes one. It is still
            // counted: an integration that answers with something this contract
            // does not know is a deployment problem, not a quiet afternoon.
            OperationalMetrics::increment('reputation.verdict_unusable');

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
     *
     * It can shorten it, and that is the direction a provider actually needs:
     * knowing a verdict is about to change and asking to be consulted again.
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

        // Between the two bounds the provider is obeyed. Answering a short
        // expiry with the full ceiling inverted the documented contract: a
        // two-minute window became a day, and a verdict the provider had already
        // called stale stayed authoritative for the rest of it.
        $floor = now()->addMinutes(self::MIN_TTL_MINUTES);
        if ($parsed->lessThan($floor)) {
            return $floor;
        }

        return $parsed->greaterThan($ceiling) ? $ceiling : $parsed;
    }
}
