import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(__dirname, "../../..");

/**
 * Returns every RATE-LIMIT budget this run has already spent to its starting
 * point — and only the budgets.
 *
 * One suite speaks from a single address for several minutes, and the deployment
 * sizes its per-address ceilings for one person: thirty cases that each register
 * an account consume the verification budget — thirty per fifteen minutes —
 * well before the last spec starts. The specs that run after that point answer
 * "Demasiados intentos de verificación" for traffic that belongs to earlier
 * cases, which is a property of the harness and not of the application.
 *
 * The reset is `uvh:e2e:reset-limits`, which deletes exactly the two budget
 * namespaces (`uvh:mfa:attempts:*` and the hashed keys of Laravel's
 * RateLimiter) on EVERY configured cache store — including every member of the
 * failover chain, so a limiter that already fell back to the second backend has
 * its budgets cleared there too. It deliberately does NOT clear the whole cache
 * store the way `cache:clear` used to: MFA challenges, TOTP replay guards,
 * locks and application caches survive between cases, because they are
 * behaviour of the system and not spent budgets of the harness. Sessions live
 * in PostgreSQL and queued jobs in another Redis database, so neither is
 * touched either.
 */
export async function resetSpentCounters(): Promise<void> {
  await execFileAsync(
    "docker",
    [
      "compose", "-p", "uvh-e2e", "-f", "docker-compose.e2e.yml",
      "exec", "-T", "app", "php", "artisan", "uvh:e2e:reset-limits",
    ],
    { cwd: repositoryRoot, encoding: "utf8", timeout: 60_000 },
  );
}
