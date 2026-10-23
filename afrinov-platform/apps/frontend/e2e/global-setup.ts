// Playwright global setup: boots the REAL backend (current source) on port 4000
// and the REAL frontend Vite dev server on port 5173 (proxied to the backend),
// so E2E tests exercise the full browser -> frontend -> HTTP -> backend -> DB
// stack. Both processes are torn down on shutdown.
import type { FullConfig } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { loadTestEnvironmentFile, requireIsolatedTestDatabaseUrl } from '../../backend/scripts/test-environment.js';
import { frontendDir, backendDir } from '../playwright.config.js';

function waitFor(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  const timer = () =>
    fetch(url, { signal: AbortSignal.timeout(2000) })
      .then((r) => (r.ok ? 'ok' : Promise.reject(new Error(`status ${r.status}`))))
      .catch(() => Promise.reject(new Error('not ready')));
  return new Promise((resolve, reject) => {
    const attempt = () => {
      timer()
        .then(() => resolve())
        .catch(() => {
          if (Date.now() - start > timeoutMs) {
            reject(new Error(`Timed out waiting for ${url}`));
          } else {
            setTimeout(attempt, 250);
          }
        });
    };
    attempt();
  });
}

function spawnServer(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): ChildProcessWithoutNullStreams {
  return spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    shell: true,
    stdio: 'pipe',
  });
}

let backend: ChildProcessWithoutNullStreams | null = null;
let frontend: ChildProcessWithoutNullStreams | null = null;

function kill(proc: ChildProcessWithoutNullStreams | null): void {
  if (!proc || proc.exitCode !== null) return;
  try {
    proc.kill('SIGTERM');
  } catch {
    // ignore
  }
  setTimeout(() => {
    try {
      proc.kill('SIGKILL');
    } catch {
      // ignore
    }
  }, 2000);
}

export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  loadTestEnvironmentFile(resolve(backendDir, '.env.test'));
  process.env.NODE_ENV = 'test';
  const databaseUrl = requireIsolatedTestDatabaseUrl();
  if (!process.env.SEED_ADMIN_PASSWORD?.trim()) {
    throw new Error('SEED_ADMIN_PASSWORD is required for the seeded test admin in the Playwright suite.');
  }

  backend = spawnServer(
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

  await waitFor('http://127.0.0.1:4000/health/ready', 30_000);

  frontend = spawnServer(
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

  await waitFor('http://127.0.0.1:5173/', 90_000);

  return async () => {
    kill(frontend);
    kill(backend);
  };
}
