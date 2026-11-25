// Playwright global setup: boots the REAL backend (current source) on port 4000
// and the REAL frontend Vite dev server on port 5173 (proxied to the backend),
// so E2E tests exercise the full browser -> frontend -> HTTP -> backend -> DB
// stack. Both are stopped with everything they started: at teardown, by an
// exit hook if the run ends before it (an error), and by the terminal's
// Ctrl+C, which reaches them as it reaches the runner. The ports
// must be free first, and each server counts as ready only while it is still
// running, so the suite doesn't test a server it didn't start (e2e/servers.ts).
import type { FullConfig } from '@playwright/test';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { loadTestEnvironmentFile, requireIsolatedTestDatabaseUrl } from '../../backend/scripts/test-environment.js';
import { frontendDir, backendDir } from '../playwright.config.js';
import { assertPortFree, assertRunning, startServer, stopServer, stopServersOnExit, waitUntilReady } from './servers.js';

/** One readiness check: the URL answers 2xx within two seconds. */
function answersOk(url: string): () => Promise<boolean> {
  return () => fetch(url, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);
}

let backend: ChildProcessWithoutNullStreams | null = null;
let frontend: ChildProcessWithoutNullStreams | null = null;

export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  loadTestEnvironmentFile(resolve(backendDir, '.env.test'));
  process.env.NODE_ENV = 'test';
  const databaseUrl = requireIsolatedTestDatabaseUrl();
  if (!process.env.SEED_ADMIN_PASSWORD?.trim()) {
    throw new Error('SEED_ADMIN_PASSWORD is required for the seeded test admin in the Playwright suite.');
  }
  await assertPortFree(4000, 'the backend');
  await assertPortFree(5173, 'the frontend');
  // If the runner exits before teardown (an error, a process.exit), the
  // servers would outlive it: this stops them as it exits.
  stopServersOnExit(() => [frontend, backend]);

  const stopBoth = async () => {
    await stopServer(frontend);
    await stopServer(backend);
  };
  try {
    await startBoth(databaseUrl);
  } catch (err) {
    // Setup failed half way: stop what did start, or it outlives the run.
    await stopBoth();
    throw err;
  }
  return stopBoth;
}

async function startBoth(databaseUrl: string): Promise<void> {
  backend = startServer(
    'npx',
    ['tsx', 'src/index.ts'],
    backendDir,
    {
      DATABASE_URL: databaseUrl,
      JWT_SECRET: randomBytes(32).toString('base64url'),
      NODE_ENV: 'test',
      PORT: '4000',
      HOST: '127.0.0.1',
      CORS_ORIGIN: 'http://localhost:5173',
    },
  );
  backend.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
  backend.stderr.on('data', (d) => process.stderr.write(`[backend] ${d}`));

  await waitUntilReady(backend, 'the backend', answersOk('http://127.0.0.1:4000/health/ready'), 30_000);

  frontend = startServer(
    'npx',
    ['vite', '--port', '5173', '--host', '--strictPort'],
    frontendDir,
    {
      VITE_FRONTEND_ONLY: 'false',
      VITE_DEMO_AUTH_ENABLED: 'false',
    },
  );
  frontend.stdout.on('data', (d) => process.stdout.write(`[frontend] ${d}`));
  frontend.stderr.on('data', (d) => process.stderr.write(`[frontend] ${d}`));

  await waitUntilReady(frontend, 'the frontend', answersOk('http://127.0.0.1:5173/'), 90_000);
  // A server that lost its port to another process exits soon after it
  // tries to listen, but the other process may have answered the readiness
  // check first. Give both a moment, then make sure they are still ours.
  await new Promise((settle) => setTimeout(settle, 1_000));
  assertRunning(frontend, 'the frontend');
  assertRunning(backend, 'the backend');
}
