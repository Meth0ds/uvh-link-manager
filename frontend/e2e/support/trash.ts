import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(__dirname, "../../..");

async function runInIsolatedBackend(arguments_: string[], timeout: number): Promise<string> {
  const { stdout } = await execFileAsync(
    "docker",
    ["compose", "-p", "uvh-e2e", "-f", "docker-compose.e2e.yml", "exec", "-T", "app", "php", ...arguments_],
    { cwd: repositoryRoot, encoding: "utf8", timeout },
  );
  return stdout.trim();
}

/** Age an exact, prefix-scoped batch; the PHP guard refuses every non-test DB. */
export async function ageE2ETrash(workspaceId: number, aliasPrefix: string, expectedCount: number): Promise<void> {
  if (!Number.isSafeInteger(workspaceId) || workspaceId < 1) throw new Error("Invalid E2E workspace ID.");
  if (!/^[a-z0-9][a-z0-9-]{2,40}$/u.test(aliasPrefix)) throw new Error("Invalid E2E trash alias prefix.");
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1 || expectedCount > 100) {
    throw new Error("Invalid E2E trash batch size.");
  }
  const result = await runInIsolatedBackend(
    ["tests/E2E/age-trash-links.php", String(workspaceId), aliasPrefix, String(expectedCount)],
    30_000,
  );
  if (result !== `aged ${expectedCount}`) throw new Error("The E2E trash-age helper returned an unexpected result.");
}

/** Run the same housekeeping command used by the scheduler in another process. */
export async function runE2EHousekeeping(): Promise<void> {
  await runInIsolatedBackend(["artisan", "uvh:housekeeping", "--no-interaction"], 120_000);
}
