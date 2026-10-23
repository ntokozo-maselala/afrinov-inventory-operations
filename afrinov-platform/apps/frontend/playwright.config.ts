import { defineConfig, devices } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTestEnvironmentFile, requireIsolatedTestDatabaseUrl } from '../backend/scripts/test-environment.js';

const here = dirname(fileURLToPath(import.meta.url));
const frontendDir = here;
const backendDir = resolve(here, '../backend');

// The browser suite must never inherit the backend's ordinary developer .env.
// It accepts only a local database whose name has the explicit `_test` suffix.
loadTestEnvironmentFile(resolve(backendDir, '.env.test'));
process.env.NODE_ENV = 'test';
requireIsolatedTestDatabaseUrl();

export { frontendDir, backendDir };

export default defineConfig({
  testDir: resolve(frontendDir, 'e2e'),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    trace: 'on-first-retry',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  globalSetup: resolve(frontendDir, 'e2e/global-setup.ts'),
});
