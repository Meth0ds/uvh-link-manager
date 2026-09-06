import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// A prior interrupted run may have left only the named E2E project alive.
// Remove that exact project before ports or stale test data can be reused.
execFileSync(
  "docker",
  ["compose", "-p", "uvh-e2e", "-f", "docker-compose.e2e.yml", "down", "--volumes", "--remove-orphans"],
  { cwd: repositoryRoot, stdio: "inherit" },
);
