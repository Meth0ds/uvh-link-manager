import { defineConfig } from "@playwright/test";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "..");

export default defineConfig({
  testDir: "./e2e/release-specs",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never", outputFolder: "playwright-report-release" }]] : "list",
  outputDir: "test-results-release",
  use: {
    ignoreHTTPSErrors: true,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "docker compose -p uvh-release-e2e -f docker-compose.release-e2e.yml up --build --force-recreate --renew-anon-volumes --remove-orphans",
    cwd: repositoryRoot,
    url: "https://app.uvh.localhost:8443/health",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 600_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  globalTeardown: "./e2e/global-teardown-release.ts",
});
