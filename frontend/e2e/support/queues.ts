import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(__dirname, "../../..");

/**
 * Drain the exports queue until it is empty.
 *
 * The browser stack runs no queue workers on purpose — anything a request puts
 * on a queue is verified by `npm run e2e:async`, not here — so a spec that
 * needs a queued job to finish supplies the consumer itself. This is the same
 * command a deployment's `queue-exports` pool runs, only bounded to the work
 * that exists right now.
 */
export async function runE2EExportsWorker(): Promise<void> {
  await execFileAsync(
    "docker",
    ["compose", "-p", "uvh-e2e", "-f", "docker-compose.e2e.yml", "exec", "-T", "app", "php",
      "artisan", "queue:work", "--queue=exports", "--stop-when-empty", "--tries=3", "--timeout=660"],
    { cwd: repositoryRoot, encoding: "utf8", timeout: 180_000 },
  );
}
