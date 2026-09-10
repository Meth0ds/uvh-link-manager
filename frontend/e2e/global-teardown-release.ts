import { execFileSync } from "node:child_process";
import path from "node:path";

export default function globalTeardown(): void {
  const repositoryRoot = path.resolve(__dirname, "../..");
  execFileSync(
    "docker",
    ["compose", "-p", "uvh-release-e2e", "-f", "docker-compose.release-e2e.yml", "down", "--volumes", "--remove-orphans"],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
}
