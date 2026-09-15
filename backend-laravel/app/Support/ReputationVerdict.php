<?php

namespace App\Support;

use Illuminate\Support\Carbon;

/**
 * What a reputation provider said about one destination.
 *
 * `unknown` is the default and carries no claim: a provider that is absent,
 * unreachable, slow or answering with something this contract does not
 * understand must never be reported as "safe". The product describes a
 * destination it has not verified as unverified, never as clean.
 */
final class ReputationVerdict
{
    public const UNKNOWN = 'unknown';

    public const SAFE = 'safe';

    public const SUSPICIOUS = 'suspicious';

    public const MALICIOUS = 'malicious';

    /** @var list<string> */
    public const VERDICTS = [self::UNKNOWN, self::SAFE, self::SUSPICIOUS, self::MALICIOUS];

    private function __construct(
        private readonly string $verdict,
        private readonly string $provider,
        private readonly Carbon $checkedAt,
        private readonly ?Carbon $expiresAt,
        private readonly ?int $score,
        private readonly ?string $error,
    ) {}

    public static function make(
        string $verdict,
        string $provider,
        ?Carbon $checkedAt = null,
        ?Carbon $expiresAt = null,
        ?int $score = null,
        ?string $error = null,
    ): self {
        if (! in_array($verdict, self::VERDICTS, true)) {
            $verdict = self::UNKNOWN;
            $error = 'unknown_verdict';
        }

        return new self(
            $verdict,
            mb_substr($provider, 0, 64),
            $checkedAt ?? now(),
            $expiresAt,
            $score,
            $error === null ? null : mb_substr($error, 0, 200),
        );
    }

    public static function unknown(string $provider, ?string $error = null, ?Carbon $checkedAt = null): self
    {
        return self::make(self::UNKNOWN, $provider, $checkedAt, null, null, $error);
    }

    public function verdict(): string
    {
        return $this->verdict;
    }

    public function provider(): string
    {
        return $this->provider;
    }

    public function checkedAt(): Carbon
    {
        return $this->checkedAt;
    }

    public function expiresAt(): ?Carbon
    {
        return $this->expiresAt;
    }

    public function score(): ?int
    {
        return $this->score;
    }

    public function error(): ?string
    {
        return $this->error;
    }

    public function isFresh(): bool
    {
        return $this->expiresAt === null || $this->expiresAt->isFuture();
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'verdict' => $this->verdict,
            'provider' => $this->provider,
            'score' => $this->score,
            'checkedAt' => $this->checkedAt->toIso8601String(),
            'expiresAt' => $this->expiresAt?->toIso8601String(),
            'error' => $this->error,
        ];
    }
}
