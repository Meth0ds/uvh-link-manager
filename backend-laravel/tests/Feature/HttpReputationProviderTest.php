<?php

namespace Tests\Feature;

use App\Support\HttpReputationProvider;
use App\Support\ReputationVerdict;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use ReflectionMethod;
use Tests\TestCase;

/**
 * What a provider's answer is allowed to mean.
 *
 * `interpret()` is private and the transport underneath it is deliberately not
 * swappable — it resolves and pins addresses, refuses redirects and is the same
 * one webhooks use — so the answer is pinned here through reflection instead of
 * through a fake HTTP client that would test a different code path.
 *
 * The case that motivated this file: a provider answering `"MALICIOUS"` used to
 * be reported as `provider_verdict_unusable`, which is `unknown`, which never
 * blocks. That is the platform's only automatic abuse-withdrawal path switching
 * itself off, and nothing in the console, the metrics or the logs said so.
 */
final class HttpReputationProviderTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE operational_metrics RESTART IDENTITY CASCADE');
    }

    /**
     * @return list<array{string, string}>
     */
    public static function acceptedVerdicts(): array
    {
        return [
            ['malicious', ReputationVerdict::MALICIOUS],
            ['MALICIOUS', ReputationVerdict::MALICIOUS],
            ['Malicious', ReputationVerdict::MALICIOUS],
            ['  malicious  ', ReputationVerdict::MALICIOUS],
            ['safe', ReputationVerdict::SAFE],
            ['SAFE', ReputationVerdict::SAFE],
            ['suspicious', ReputationVerdict::SUSPICIOUS],
            ['Suspicious', ReputationVerdict::SUSPICIOUS],
        ];
    }

    #[DataProvider('acceptedVerdicts')]
    public function test_a_verdict_is_read_regardless_of_its_casing(string $raw, string $expected): void
    {
        $verdict = $this->interpret(['verdict' => $raw, 'score' => 80]);

        $this->assertSame($expected, $verdict->verdict());
        $this->assertNull($verdict->error());
        $this->assertSame(80, $verdict->score());
        $this->assertSame(
            0,
            (int) DB::table('operational_metrics')->where('metric', 'reputation.verdict_unusable')->sum('count'),
        );
    }

    /**
     * @return list<array{string}>
     */
    public static function unusableVerdicts(): array
    {
        return [
            ['unknown'],
            ['UNKNOWN'],
            ['maybe'],
            [''],
            ['malicious but not really'],
        ];
    }

    #[DataProvider('unusableVerdicts')]
    public function test_an_answer_the_contract_does_not_describe_never_becomes_a_claim(string $raw): void
    {
        $verdict = $this->interpret(['verdict' => $raw]);

        $this->assertSame(ReputationVerdict::UNKNOWN, $verdict->verdict());
        $this->assertSame('provider_verdict_unusable', $verdict->error());
        // Counted, not swallowed: an integration answering in a shape this
        // contract does not know is a deployment fault, not a quiet afternoon.
        $this->assertGreaterThan(
            0,
            (int) DB::table('operational_metrics')->where('metric', 'reputation.verdict_unusable')->sum('count'),
        );
    }

    public function test_a_provider_asking_to_be_consulted_sooner_is_obeyed(): void
    {
        // The reviewed bug: the two bounds were collapsed into one, so a
        // `two-minute` window was answered with the configured ceiling. A
        // provider that knows its verdict is about to change had its warning
        // turned into 24 hours of authority, and the documentation claimed the
        // opposite of what the code did.
        $expiresAt = $this->interpret(['verdict' => 'malicious', 'expiresAt' => now()->addMinutes(2)->toIso8601String()])
            ->expiresAt();

        $this->assertNotNull($expiresAt);
        $this->assertEqualsWithDelta(
            now()->addMinutes(5)->getTimestamp(),
            $expiresAt->getTimestamp(),
            5,
            'a short expiry is raised to the floor, never to the ceiling',
        );
    }

    public function test_a_provider_cannot_extend_its_own_window_past_the_ceiling(): void
    {
        $expiresAt = $this->interpret(['verdict' => 'safe', 'expiresAt' => now()->addDays(30)->toIso8601String()])
            ->expiresAt();

        $this->assertNotNull($expiresAt);
        $this->assertEqualsWithDelta(
            now()->addHours(24)->getTimestamp(),
            $expiresAt->getTimestamp(),
            5,
        );
    }

    public function test_between_the_bounds_the_provider_is_obeyed_and_garbage_gets_the_ceiling(): void
    {
        $honoured = $this->interpret(['verdict' => 'suspicious', 'expiresAt' => now()->addHours(6)->toIso8601String()])
            ->expiresAt();
        $this->assertNotNull($honoured);
        $this->assertEqualsWithDelta(now()->addHours(6)->getTimestamp(), $honoured->getTimestamp(), 5);

        foreach ([null, 'soon', str_repeat('x', 100)] as $raw) {
            $expiresAt = $this->interpret(['verdict' => 'safe', 'expiresAt' => $raw])->expiresAt();
            $this->assertNotNull($expiresAt);
            $this->assertEqualsWithDelta(
                now()->addHours(24)->getTimestamp(),
                $expiresAt->getTimestamp(),
                5,
                'an unreadable expiry falls back to the configured ceiling',
            );
        }
    }

    public function test_a_missing_or_non_string_verdict_is_unusable_and_not_a_type_error(): void
    {
        foreach ([null, 42, ['malicious'], true] as $raw) {
            $body = $raw === null ? '{}' : json_encode(['verdict' => $raw]);
            $this->assertIsString($body);

            $verdict = $this->interpretBody($body);
            $this->assertSame(ReputationVerdict::UNKNOWN, $verdict->verdict());
            $this->assertSame('provider_verdict_unusable', $verdict->error());
        }

        $this->assertSame('provider_not_json', $this->interpretBody('not json')->error());
    }

    /** @param array<string, mixed> $body */
    private function interpret(array $body): ReputationVerdict
    {
        $encoded = json_encode($body);
        $this->assertIsString($encoded);

        return $this->interpretBody($encoded);
    }

    private function interpretBody(string $body): ReputationVerdict
    {
        $provider = new HttpReputationProvider([
            'url' => 'https://reputation.example.test/api',
            'token' => '',
            'timeout_ms' => 1000,
            'max_body_bytes' => 4096,
            'ttl_hours' => 24,
        ]);

        $interpret = new ReflectionMethod($provider, 'interpret');

        $verdict = $interpret->invoke($provider, $body);
        $this->assertInstanceOf(ReputationVerdict::class, $verdict);

        return $verdict;
    }
}
