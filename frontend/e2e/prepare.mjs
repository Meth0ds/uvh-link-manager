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

// A clean checkout intentionally has no versioned vendor directory. Install
// the locked backend dependencies through the same PHP image used by the E2E
// application before Laravel is started. The bind mount keeps vendor available
// to the later app container; --no-deps avoids starting or mutating a database.
execFileSync(
  "docker",
  [
    "compose", "-p", "uvh-e2e", "-f", "docker-compose.e2e.yml",
    "run", "--rm", "--no-deps", "app",
    "composer", "install", "--no-interaction", "--prefer-dist", "--no-progress",
  ],
  { cwd: repositoryRoot, stdio: "inherit" },
);
