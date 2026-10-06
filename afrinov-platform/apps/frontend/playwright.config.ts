import { defineConfig, devices } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const frontendDir = here;
const backendDir = resolve(here, '../backend');

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
