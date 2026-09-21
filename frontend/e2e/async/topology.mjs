/**
 * Where the stack lives and how it is driven.
 *
 * Coordinates of the compose project (files, ports, provider endpoints) and the
 * one process driver the suite uses to talk to it. Nothing here knows about a
 * scenario: a scenario asks this module to run a command or to read a
 * subcommand's JSON, and owns nothing about the stack itself.
 */

import { execFile, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Three levels up from `frontend/e2e/async/`: the compose files and the images
// are named relative to the repository root, not to this module.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const project = "uvh-async-e2e";
const composeFile = "docker-compose.async-e2e.yml";
// Optional overlays. The capacity drill adds php-fpm behind nginx
// (`docker-compose.analytics-drill.yml`) so its arrival passes measure a real web
// tier instead of PHP's built-in server, which is a ceiling on the harness.
// CI never sets this and keeps the default topology.
const extraComposeFiles = (process.env.UVH_ASYNC_EXTRA_COMPOSE ?? "")
  .split(",")
  .map((file) => file.trim())
  .filter((file) => file !== "");
const compose = [
  "compose",
  "-p",
  project,
  ...[composeFile, ...extraComposeFiles].flatMap((file) => ["-f", file]),
];

const backendPort = process.env.UVH_ASYNC_BACKEND_PORT ?? "8011";
export const backend = `http://127.0.0.1:${backendPort}`;
// Where admitted redirect traffic is sent. With `UVH_ASYNC_EDGE=1` it goes through
// the nginx + php-fpm overlay, which is the only way an arrival pass can reach a
// regime where the rollup row has a backlog behind it on a laptop-shaped stack.
const edgePort = process.env.UVH_ASYNC_EDGE_PORT ?? "8012";
export const redirectOrigin = process.env.UVH_ASYNC_EDGE === "1" ? `http://127.0.0.1:${edgePort}` : backend;
export const control = {
  webhook: `http://127.0.0.1:${process.env.UVH_ASYNC_WEBHOOK_CONTROL_PORT ?? "8090"}`,
  dns: `http://127.0.0.1:${process.env.UVH_ASYNC_DNS_CONTROL_PORT ?? "8091"}`,
  mail: `http://127.0.0.1:${process.env.UVH_ASYNC_MAIL_CONTROL_PORT ?? "8092"}`,
};
export const schedulerDeadlineMs = Number(process.env.UVH_ASYNC_SCHEDULER_DEADLINE_MS ?? 150_000);
/**
 * Windows reports a failed process *creation* as 0xC0000142 (3221225794),
 * with no output at all. Docker Desktop does this intermittently under memory
 * pressure — the CLI never ran, so retrying is not re-executing anything. A
 * real command failure is different: the CLI ran and returned output plus a
 * status, and those are never retried.
 */
const SPAWN_FAILURE_STATUS = 3221225794; // 0xC0000142 on Windows.

/** Blocking sleep: the callers are synchronous by construction. */
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export function docker(args, { capture = false } = {}) {
  const attempt = () =>
    execFileSync("docker", [...compose, ...args], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      timeout: 900_000,
    });

  // Docker Desktop needs time to settle before it can initialise a new CLI
  // process again, so the waits grow instead of hammering it.
  const backoffMs = [5_000, 15_000, 30_000];

  for (let tries = 0; ; tries += 1) {
    try {
      return attempt();
    } catch (error) {
      // The status is the discriminator, not the output: with an inherited
      // stdio the output arrays are empty on a real non-zero exit too.
      if (error?.status !== SPAWN_FAILURE_STATUS || tries >= backoffMs.length) throw error;
      console.error(
        `docker ${args.slice(0, 2).join(" ")} could not be spawned; retrying in ${backoffMs[tries] / 1000}s (${tries + 1}/${backoffMs.length})`,
      );
      sleepSync(backoffMs[tries]);
    }
  }
}

export function inspect(...args) {
  const stdout = docker(["exec", "-T", "app", "php", "tests/E2E/async-inspect.php", ...args], { capture: true });
  return JSON.parse(stdout.trim());
}

const execFileAsync = promisify(execFile);

/**
 * Non-blocking twin of `inspect`, for sampling while traffic is in flight.
 * `docker exec` is a synchronous child process: it would stall the event loop,
 * and with it the load generator, for the whole lifetime of every sample — the
 * harness would end up measuring itself.
 */
export async function inspectAsync(...args) {
  const { stdout } = await execFileAsync(
    "docker",
    [...compose, "exec", "-T", "app", "php", "tests/E2E/async-inspect.php", ...args],
    { cwd: repositoryRoot, encoding: "utf8", timeout: 180_000 },
  );
  return JSON.parse(stdout.trim());
}

/**
 * Name of a service whose container is running, or null when it is absent.
 *
 * `compose pause`/`unpause` address services, not container ids: passing the id
 * back fails with "no such service". The service name is therefore what gets
 * returned, and the id is only used to prove the container exists.
 */
export function runningService(service) {
  return docker(["ps", "-q", service], { capture: true }).trim() === "" ? null : service;
}
