import { execFileSync } from "node:child_process";
import path from "node:path";

export default function globalTeardown(): void {
  const repositoryRoot = path.resolve(__dirname, "../..");
  try {
    execFileSync(
      "docker",
      ["compose", "-p", "uvh-e2e", "-f", "docker-compose.e2e.yml", "down", "--volumes", "--remove-orphans"],
      { cwd: repositoryRoot, stdio: "inherit" },
    );
  } catch (error) {
    // Cleanup is part of the isolation contract. Surface its original error
    // and fail the run instead of reporting green while containers or test
    // data may still exist; pree2e remains a second, exact-project safeguard.
    console.error("No se pudo desmontar el stack E2E aislado.", error);
    throw error;
  }
}
