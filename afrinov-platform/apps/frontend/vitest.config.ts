import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'app',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          globals: true,
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
        },
      },
      {
        // The browser suite's own helpers (starting and stopping its servers):
        // Node code, tested in Node. Its browser specs, e2e/*.spec.ts, run
        // under Playwright.
        test: {
          name: 'e2e-helpers',
          environment: 'node',
          include: ['e2e/**/*.test.ts'],
        },
      },
    ],
  },
});