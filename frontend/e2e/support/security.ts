import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(__dirname, "../../..");

async function runInIsolatedBackend(arguments_: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "docker",
    ["compose", "-p", "uvh-e2e", "-f", "docker-compose.e2e.yml", "exec", "-T", "app", "php", ...arguments_],
    { cwd: repositoryRoot, encoding: "utf8", timeout: 30_000 },
  );
  return stdout.trim();
}

/** Promote only a fully verified, MFA-enabled account through the audited command. */
export async function promoteE2EAdmin(email: string): Promise<void> {
  if (!/^[^\s@]+@[^\s@]+$/u.test(email)) throw new Error("Invalid E2E admin email.");
  await runInIsolatedBackend(["artisan", "uvh:admin:promote", email, "--no-interaction"]);
}

/** Make the current test session stale without weakening the production TTL. */
export async function ageE2EMfaSession(email: string): Promise<void> {
  if (!/^[^\s@]+@[^\s@]+$/u.test(email)) throw new Error("Invalid E2E session email.");
  const result = await runInIsolatedBackend(["tests/E2E/age-mfa-session.php", email]);
  if (result !== "aged") throw new Error("The E2E session-age helper returned an unexpected result.");
}
