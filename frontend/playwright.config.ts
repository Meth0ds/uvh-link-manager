import { defineConfig } from "@playwright/test";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "..");

export default defineConfig({
  testDir: "./e2e/specs",
  fullyParallel: false,
  // The E2E stack intentionally shares one ephemeral database. Serial workers
  // keep state transitions deterministic while individual tests use unique IDs.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // Authentication endpoints intentionally normalize response time. Complex
  // lifecycle journeys therefore need more time than a single-page assertion.
  timeout: 300_000,
  expect: { timeout: 60_000 },
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: "http://127.0.0.1:4201",
    // A missing response or obstructed control must fail quickly enough to
    // produce useful diagnostics instead of consuming the whole journey.
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "docker compose -p uvh-e2e -f docker-compose.e2e.yml up --build --force-recreate --renew-anon-volumes --remove-orphans",
      cwd: repositoryRoot,
      url: "http://127.0.0.1:8010/health",
      reuseExistingServer: false,
      // A cold CI runner compiles the PHP extensions before starting Laravel.
      // Keep this independent from per-test timeouts so the initial build does
      // not masquerade as an application failure.
      timeout: 600_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "npm start -- --host 127.0.0.1 --port 4201",
      cwd: __dirname,
      // Angular's CLI prefers `PORT` over `--port`, so a caller that exports it
      // —a container runtime, a dev-server manager, a shell that sets it for
      // something else— moves the application to a port of its choosing while
      // this config keeps probing 4201. The run then dies on the readiness
      // timeout with a server that was listening perfectly well somewhere else.
      // Where the suite looks is decided here, not by whoever launched it.
      env: { ...process.env, PORT: "4201", BACKEND_URL: "http://127.0.0.1:8010" },
      url: "http://127.0.0.1:4201",
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
  globalTeardown: "./e2e/global-teardown.ts",
});
