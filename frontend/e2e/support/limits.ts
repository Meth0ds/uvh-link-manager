import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(__dirname, "../../..");

/**
 * Returns every budget this run has already spent to its starting point.
 *
 * One suite speaks from a single address for several minutes, and the deployment
 * sizes its per-address ceilings for one person: thirty cases that each register
 * an account and consume a bearer spend the verification budget — thirty per
 * fifteen minutes — well before the last spec starts. The specs that run after
 * that point answer "Demasiados intentos de verificación" for traffic that
 * belongs to earlier cases, which is a property of the harness and not of the
 * application.
 *
 * The counters live in the run's own cache store (the availability limiters
 * count on the failover chain, whose live member is Redis, and the credential
 * limiters fall back to that same store when no dedicated one is configured), so
 * clearing the cache is what makes a case start where a case is meant to start.
 * It is deliberately scoped to derived state: sessions live in PostgreSQL and
 * queued jobs in another Redis database, so neither is touched. The backend
 * suite solves the same problem the same way — `TestCase::setUp()` truncates the
 * global counters before each case.
 */
export async function resetSpentCounters(): Promise<void> {
  await execFileAsync(
    "docker",
    [
      "compose", "-p", "uvh-e2e", "-f", "docker-compose.e2e.yml",
      "exec", "-T", "app", "php", "artisan", "cache:clear",
    ],
    { cwd: repositoryRoot, encoding: "utf8", timeout: 60_000 },
  );
}
