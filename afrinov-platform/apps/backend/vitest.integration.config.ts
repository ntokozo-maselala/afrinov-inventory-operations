import { defineConfig } from 'vitest/config';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { loadTestEnvironmentFile, requireIsolatedTestDatabaseUrl } from './scripts/test-environment.js';

// Never fall back to the developer .env file for tests. A shell-provided URL
// or the explicitly named .env.test must point to a local *_test database.
loadTestEnvironmentFile(resolve(process.cwd(), '.env.test'));
process.env.NODE_ENV = 'test';
requireIsolatedTestDatabaseUrl();
// Tests use a fresh process-local signer and never inherit a deployment key.
process.env.JWT_SECRET = randomBytes(32).toString('base64url');

export default defineConfig({
  test: {
    environment: 'node',
    include: ['integration/**/*.test.ts'],
    isolate: false,
    singleFork: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
