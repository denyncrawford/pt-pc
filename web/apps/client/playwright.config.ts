import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser-tests',
  outputDir: '../../../.cache/opfs-test-results',
  timeout: 60_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4175', headless: true },
  webServer: {
    command: 'bun scripts/serve-static.ts',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
  },
});
