import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4173/scratchtrack/',
  },
  webServer: {
    command: 'node e2e/server.mjs 4173',
    url: 'http://localhost:4173/scratchtrack/',
    reuseExistingServer: true,
    timeout: 30000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
