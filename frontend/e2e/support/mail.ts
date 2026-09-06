import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(__dirname, "../../..");

export async function readMailLink(email: string, kind: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(
        "docker",
        [
          "compose", "-p", "uvh-e2e", "-f", "docker-compose.e2e.yml",
          "exec", "-T", "app", "php", "tests/E2E/read-mail-link.php", email, kind,
        ],
        // Booting Laravel through a Windows bind mount can exceed ten seconds
        // on a cold filesystem cache. This process is still bounded and the
        // helper itself limits both rows scanned and output origin.
        { cwd: repositoryRoot, encoding: "utf8", timeout: 30_000 },
      );
      const url = stdout.trim();
      if (url.startsWith("http://127.0.0.1:4201/")) return url;
      lastError = new Error("The mail helper returned an unexpected origin.");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError instanceof Error ? lastError : new Error("No matching mail link was produced.");
}
