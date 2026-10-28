import { defineConfig } from 'vitest/config';

// Provide a dummy DATABASE_URL so @prisma/client module load doesn't crash.
// The real prisma is replaced by vi.mock('../shared/db.js', ...) in tests
// that exercise the inventory service — they never hit the real client.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test?schema=public';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    // Vitest 5 removed `singleFork`; run every file in one worker process so
    // the mocked singleton Prisma client stays shared across test files.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
