<?php

namespace Tests\Feature;

use App\Models\Link;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use Illuminate\Support\Facades\DB;
use Symfony\Component\Process\Process;
use Tests\TestCase;

/**
 * Real multi-process proof for the redirect admission boundary.
 *
 * Every worker is a separate OS process (see
 * `tests/Support/redirect-probe.php`) released from a shared wall-clock barrier
 * and pointed at the same database, so the guarantees are exercised by actual
 * parallel connections rather than by sequential calls wearing a concurrency
 * name.
 *
 * The overlap assertion matters as much as the counts: a harness that silently
 * serialized its workers would pass every "exactly one winner" assertion while
 * proving nothing, which is how a concurrency claim becomes folklore.
 *
 * What these tests prove is correctness under real parallel admissions, and
 * that the unlimited path survives concurrent increments without losing one,
 * which also keeps the counter bump inside its own statement: moving it back
 * under the shared lock would deadlock on the lock upgrade and fail here.
 *
 * What they do not prove is throughput. Lock modes and their effect on
 * latency are measured against a hot alias with `scripts/benchmark-redirects.mjs`
 * and the PostgreSQL lock/waits capture that `docs/redirect-and-webhook-availability-policy.md`
 * already requires, not inferred from a green suite.
 */
final class RedirectConcurrencyTest extends TestCase
{
    private const WORKERS = 8;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users RESTART IDENTITY CASCADE');
    }

    public function test_single_use_link_has_exactly_one_winner_under_parallel_admissions(): void
    {
        [$owner, $workspace] = $this->workspace();
        $link = $this->link($workspace, $owner, 'parallel-one-shot', ['single_use' => true]);

        $results = $this->probe('parallel-one-shot', self::WORKERS);

        $this->assertSame(1, $this->countKind($results, 'redirect'), $this->describe($results));
        $this->assertSame(self::WORKERS - 1, $this->countKind($results, 'gone'), $this->describe($results));
        $this->assertSame(1, (int) $link->fresh()->click_count);
        $this->assertNoProbeErrors($results);
        $this->assertWorkersOverlapped($results);
    }

    public function test_max_clicks_admits_exactly_the_quota_under_parallel_admissions(): void
    {
        [$owner, $workspace] = $this->workspace();
        $link = $this->link($workspace, $owner, 'parallel-quota', ['max_clicks' => 3]);

        $results = $this->probe('parallel-quota', self::WORKERS);

        $this->assertSame(3, $this->countKind($results, 'redirect'), $this->describe($results));
        $this->assertSame(self::WORKERS - 3, $this->countKind($results, 'gone'), $this->describe($results));
        $this->assertSame(3, (int) $link->fresh()->click_count);
        $this->assertNoProbeErrors($results);
        $this->assertWorkersOverlapped($results);
    }

    /**
     * Control case: it proves the harness really does get many admissions into
     * the database at once, and that no parallel increment is lost. A lost
     * update would show as a counter below the admitted clicks.
     */
    public function test_parallel_admissions_of_a_plain_link_never_lose_a_count(): void
    {
        [$owner, $workspace] = $this->workspace();
        $link = $this->link($workspace, $owner, 'parallel-plain');

        $results = $this->probe('parallel-plain', self::WORKERS);

        $this->assertSame(self::WORKERS, $this->countKind($results, 'redirect'), $this->describe($results));
        $this->assertSame(self::WORKERS, (int) $link->fresh()->click_count);
        $this->assertNoProbeErrors($results);
        $this->assertWorkersOverlapped($results);
    }

    // ---------------- harness ----------------

    /**
     * @return array<int, array{start: float, end: float, kind: ?string, reason: ?string, error: ?string}>
     */
    private function probe(string $alias, int $workers): array
    {
        // Room for every worker to boot, then a shared instant to enter the
        // resolution window together.
        $startAt = microtime(true) + 3.0;
        $environment = $this->probeEnvironment();

        $processes = [];
        foreach (range(0, $workers - 1) as $worker) {
            $process = new Process([
                PHP_BINARY,
                base_path('tests/Support/redirect-probe.php'),
                '--alias='.$alias,
                '--host='.(string) config('uvh.public_host'),
                '--at='.$startAt,
                '--ip=127.0.0.'.($worker + 1),
            ], base_path(), $environment);
            $process->setTimeout(60);
            $process->start();
            $processes[] = $process;
        }

        $results = [];
        foreach ($processes as $process) {
            $process->wait();
            $results[] = $this->decodeProbe($process);
        }

        return $results;
    }

    /**
     * Pin every value the probe needs instead of trusting whatever the parent
     * happened to export. The database name comes from the live connection, so
     * the workers can never drift onto a non-test database.
     *
     * @return array<string, string>
     */
    private function probeEnvironment(): array
    {
        $connection = config('database.connections.pgsql');
        if (! is_array($connection)) {
            $this->fail('The postgres connection is not configured as an array; the probe cannot be pinned.');
        }

        return [
            'APP_ENV' => 'testing',
            'APP_KEY' => (string) config('app.key'),
            'DB_CONNECTION' => 'pgsql',
            'DB_HOST' => (string) $connection['host'],
            'DB_PORT' => (string) $connection['port'],
            'DB_DATABASE' => (string) DB::connection()->getDatabaseName(),
            'DB_USERNAME' => (string) $connection['username'],
            'DB_PASSWORD' => (string) $connection['password'],
            'QUEUE_CONNECTION' => 'sync',
            'CACHE_STORE' => 'array',
            'SESSION_DRIVER' => 'array',
            'PUBLIC_HOST' => (string) config('uvh.public_host'),
        ];
    }

    /**
     * @return array{start: float, end: float, kind: ?string, reason: ?string, error: ?string}
     */
    private function decodeProbe(Process $process): array
    {
        if (! $process->isSuccessful()) {
            $this->fail('Redirect probe exited with '.$process->getExitCode().': '.trim($process->getErrorOutput()));
        }

        // Keep only the last line: a bootstrap warning must not hide the verdict.
        $lines = array_values(array_filter(explode("\n", trim($process->getOutput())), fn (string $line): bool => trim($line) !== ''));
        $decoded = json_decode((string) end($lines), true);

        if (! is_array($decoded) || ! isset($decoded['start'], $decoded['end'])) {
            $this->fail('Redirect probe did not report a verdict: '.trim($process->getOutput()));
        }

        return [
            'start' => (float) $decoded['start'],
            'end' => (float) $decoded['end'],
            'kind' => isset($decoded['kind']) ? (string) $decoded['kind'] : null,
            'reason' => isset($decoded['reason']) ? (string) $decoded['reason'] : null,
            'error' => isset($decoded['error']) ? (string) $decoded['error'] : null,
        ];
    }

    /** @param array<int, array{start: float, end: float, kind: ?string, reason: ?string, error: ?string}> $results */
    private function assertWorkersOverlapped(array $results): void
    {
        $overlapping = 0;
        foreach ($results as $left => $first) {
            foreach ($results as $right => $second) {
                if ($right <= $left) {
                    continue;
                }
                if ($first['start'] < $second['end'] && $second['start'] < $first['end']) {
                    $overlapping++;
                }
            }
        }

        $this->assertGreaterThan(
            0,
            $overlapping,
            'No two workers overlapped inside the resolution, so this run proves nothing about concurrency: '.$this->describe($results),
        );
    }

    /** @param array<int, array{start: float, end: float, kind: ?string, reason: ?string, error: ?string}> $results */
    private function assertNoProbeErrors(array $results): void
    {
        foreach ($results as $result) {
            $this->assertNull($result['error'], 'Probe raised: '.$result['error']);
        }
    }

    /** @param array<int, array{start: float, end: float, kind: ?string, reason: ?string, error: ?string}> $results */
    private function countKind(array $results, string $kind): int
    {
        return count(array_filter($results, fn (array $result): bool => $result['kind'] === $kind));
    }

    /** @param array<int, array{start: float, end: float, kind: ?string, reason: ?string, error: ?string}> $results */
    private function describe(array $results): string
    {
        return json_encode(array_map(
            fn (array $result): string => (string) ($result['kind'] ?? 'none').(($result['reason'] ?? null) !== null ? ':'.$result['reason'] : ''),
            $results,
        )) ?: '[]';
    }

    // ---------------- fixtures ----------------

    /** @param array<string, mixed> $attributes */
    private function link(Workspace $workspace, User $creator, string $alias, array $attributes = []): Link
    {
        return Link::create(array_merge([
            'workspace_id' => $workspace->id,
            'created_by' => $creator->id,
            'alias' => $alias,
            'destination' => 'https://example.test/'.$alias,
            'state' => 'active',
        ], $attributes));
    }

    /** @return array{User, Workspace} */
    private function workspace(): array
    {
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Parallel', 'slug' => 'parallel-'.Ids::randomToken(8)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);

        return [$owner, $workspace];
    }
}
