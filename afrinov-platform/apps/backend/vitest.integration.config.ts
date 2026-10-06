import { defineConfig } from 'vitest/config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Minimal .env loader (dotenv is not installed in this workspace). Loads the
// real local database credentials so integration tests talk to a LIVE
// PostgreSQL instance instead of the dummy URL used by unit tests.
function loadEnvFile(file: string): void {
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile(resolve(process.cwd(), '.env'));

// Drive the real server so Fastify's CORS plugin reflects the request origin
// (production disables reflection). Mirrors `npm run dev` behaviour.
process.env.NODE_ENV = 'development';

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
