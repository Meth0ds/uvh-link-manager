import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Remove only the dedicated release-smoke project. Its volumes contain no
// reusable data and the `_test` database guard remains authoritative.
execFileSync(
  "docker",
  ["compose", "-p", "uvh-release-e2e", "-f", "docker-compose.release-e2e.yml", "down", "--volumes", "--remove-orphans"],
  { cwd: repositoryRoot, stdio: "inherit" },
);
