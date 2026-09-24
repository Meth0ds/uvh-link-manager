<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Symfony\Component\Process\Process;
use Tests\TestCase;

/**
 * Real multi-process proof that ONE edit secret authorises exactly ONE
 * correction, whatever the interleaving.
 *
 * Two workers (see `tests/Support/registration-edit-probe.php`) release from a
 * shared wall-clock barrier and issue the SAME correction secret for the SAME
 * pending registration through the HTTP kernel of their own OS process, each
 * trying to move the address somewhere different. A move rotates
 * `security_version`, which is what spends the secret that authorised it — so
 * exactly one correction may succeed.
 *
 * The interleaving is the TOCTOU one —both requests validate the secret before
 * either commits— and the harness FORCES it instead of hoping for it: a
 * test-only trigger makes the winner's credential rotation sleep 1.5 s inside
 * its transaction, so the loser's pre-lock validation is guaranteed to run
 * while the row still carries generation 1. Without the under-lock
 * revalidation the loser would then find the row at generation 2 and rotate it
 * to 3: one single-use secret spent twice, silently. With it, the loser meets
 * its refusal at the lock and the outcome is one winner under every schedule.
 *
 * The overlap assertion matters as much as the counts: a harness that silently
 * serialized its workers would pass every "exactly one winner" assertion while
 * proving nothing, which is how a concurrency claim becomes folklore.
 */
final class RegistrationEditConcurrencyTest extends TestCase
{
    private const WORKERS = 2;

    private const PASSWORD = 'tiovivo-cobrizo-astilla-42';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, quotas, email_tokens, mail_outbox, audit_events, operational_metrics RESTART IDENTITY CASCADE');

        // Cookies sin cifrar y par double-submit CSRF, igual que el resto de
        // superficie de auth: `uvh.csrf` exige cookie y cabecera iguales.
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'concurrency-csrf')->withHeaders(['X-CSRF-Token' => 'concurrency-csrf']);
    }

    protected function tearDown(): void
    {
        $this->dropSlowRotationTrigger();
        parent::tearDown();
    }

    public function test_one_edit_secret_authorises_exactly_one_correction(): void
    {
        $email = 'carrera-'.strtolower(bin2hex(random_bytes(4))).'@example.com';
        $registered = $this->postJson('/api/v1/auth/register', array_merge([
            'name' => 'Carrera User',
            'email' => $email,
            'password' => self::PASSWORD,
        ], $this->captchaPayload()))->assertStatus(201);
        $secret = (string) $this->cookieFrom($registered, 'uvh_registration_edit');
        $this->assertNotSame('', $secret);
        $user = User::where('email', $email)->firstOrFail();
        $this->assertSame(1, (int) $user->security_version);

        $destinations = [
            'ganadora-'.strtolower(bin2hex(random_bytes(4))).'@example.com',
            'perdedora-'.strtolower(bin2hex(random_bytes(4))).'@example.com',
        ];

        $this->installSlowRotationTrigger();
        $results = $this->probe($email, $secret, $destinations);
        $this->dropSlowRotationTrigger();

        $this->assertSame(1, $this->countKind($results, 'ok'), $this->describe($results));
        $this->assertSame(1, $this->countKind($results, 'refused'), $this->describe($results));
        $this->assertNoProbeErrors($results);
        $this->assertWorkersOverlapped($results);

        // Exactly one move landed, and the generation advanced exactly once:
        // the loser's request found a row already rotated and refused instead
        // of rotating it again.
        $user->refresh();
        $this->assertSame(2, (int) $user->security_version);
        $this->assertContains($user->email, $destinations);
        $this->assertSame(1, User::whereIn('email', $destinations)->count());
    }

    // ---------------- harness ----------------

    /**
     * @param  list<string>  $destinations
     * @return array<int, array{start: float, end: float, kind: ?string, error: ?string}>
     */
    private function probe(string $email, string $secret, array $destinations): array
    {
        // Room for every worker to boot, then a shared instant to enter the
        // request together.
        $startAt = microtime(true) + 3.0;
        $environment = $this->probeEnvironment();

        $processes = [];
        foreach (array_slice($destinations, 0, self::WORKERS) as $destination) {
            $process = new Process([
                PHP_BINARY,
                base_path('tests/Support/registration-edit-probe.php'),
                '--host='.(string) config('uvh.app_host'),
                '--email='.$email,
                '--new='.$destination,
                '--cookie='.$secret,
                '--at='.$startAt,
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
            'APP_HOST' => (string) config('uvh.app_host'),
        ];
    }

    /** @return array{start: float, end: float, kind: ?string, error: ?string} */
    private function decodeProbe(Process $process): array
    {
        if (! $process->isSuccessful()) {
            $this->fail('Edit probe exited with '.$process->getExitCode().': '.trim($process->getErrorOutput()));
        }

        // Keep only the last line: a bootstrap warning must not hide the verdict.
        $lines = array_values(array_filter(explode("\n", trim($process->getOutput())), fn (string $line): bool => trim($line) !== ''));
        $decoded = json_decode((string) end($lines), true);

        if (! is_array($decoded) || ! isset($decoded['start'], $decoded['end'])) {
            $this->fail('Edit probe did not report a verdict: '.trim($process->getOutput()));
        }

        return [
            'start' => (float) $decoded['start'],
            'end' => (float) $decoded['end'],
            'kind' => isset($decoded['kind']) ? (string) $decoded['kind'] : null,
            'error' => isset($decoded['error']) ? (string) $decoded['error'] : null,
        ];
    }

    /** @param array<int, array{start: float, end: float, kind: ?string, error: ?string}> $results */
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
            'No two workers overlapped inside the correction window, so this run proves nothing about concurrency: '.$this->describe($results),
        );
    }

    /** @param array<int, array{start: float, end: float, kind: ?string, error: ?string}> $results */
    private function assertNoProbeErrors(array $results): void
    {
        foreach ($results as $result) {
            $this->assertNull($result['error'], 'Probe raised: '.$result['error']);
        }
    }

    /** @param array<int, array{start: float, end: float, kind: ?string, error: ?string}> $results */
    private function countKind(array $results, string $kind): int
    {
        return count(array_filter($results, fn (array $result): bool => $result['kind'] === $kind));
    }

    /** @param array<int, array{start: float, end: float, kind: ?string, error: ?string}> $results */
    private function describe(array $results): string
    {
        return json_encode(array_map(
            fn (array $result): string => (string) ($result['kind'] ?? 'none').(($result['error'] ?? null) !== null ? ':'.$result['error'] : ''),
            $results,
        )) ?: '[]';
    }

    // ---------------- the forced TOCTOU window ----------------

    /**
     * A test-only trigger that makes every `users.security_version` rotation
     * sleep 1.5 s INSIDE its transaction. That is the whole forcing trick: the
     * winner holds the row lock while sleeping, so the loser's pre-lock
     * validation —which happens milliseconds after the barrier— is guaranteed
     * to run against generation 1 while the commit lands 1.5 s later.
     */
    private function installSlowRotationTrigger(): void
    {
        DB::statement(<<<'SQL'
CREATE OR REPLACE FUNCTION uvh_test_slow_security_version() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
    PERFORM pg_sleep(1.5);
    RETURN NEW;
END;
$fn$
SQL);
        DB::statement('CREATE TRIGGER uvh_test_slow_security_version BEFORE UPDATE OF security_version ON users FOR EACH ROW EXECUTE FUNCTION uvh_test_slow_security_version()');
    }

    private function dropSlowRotationTrigger(): void
    {
        DB::statement('DROP TRIGGER IF EXISTS uvh_test_slow_security_version ON users');
        DB::statement('DROP FUNCTION IF EXISTS uvh_test_slow_security_version()');
    }

    // ---------------- fixtures ----------------

    /** @return array{captchaToken: string, acceptTerms: true, termsVersion: string, privacyVersion: string} */
    private function captchaPayload(): array
    {
        return [
            'captchaToken' => 'test-registration-passcode',
            'acceptTerms' => true,
            'termsVersion' => '2026-08-30',
            'privacyVersion' => '2026-08-30',
        ];
    }

    private function cookieFrom($response, string $name): ?string
    {
        foreach ($response->headers->getCookies() as $cookie) {
            if ($cookie->getName() === $name) {
                return $cookie->getValue();
            }
        }

        return null;
    }
}
