import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', workers: 1, fullyParallel: false, retries: 0, timeout: 30000,
  reporter: [['list']], outputDir: 'test-results',
  use: { baseURL: 'http://127.0.0.1:4597', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node e2e/server.mjs', url: 'http://127.0.0.1:4597/', reuseExistingServer: false, timeout: 15000 },
});
