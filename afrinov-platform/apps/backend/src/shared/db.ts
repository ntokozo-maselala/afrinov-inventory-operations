// Single PrismaClient instance. Avoid creating multiple in dev (tsx watch hot reload).
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

declare global {
  var __prisma: PrismaClient | undefined;
}

// The driver adapter hands these straight to `pg`, whose defaults differ from
// Prisma's: `pg` has no connect timeout (`0` = wait forever), so a blackholed
// database would make `/health/ready` and every request hang instead of failing
// fast. These restore the Prisma defaults of a 5s connect and a 10s idle timeout.
const CONNECT_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 10_000;
const MAX_POOL_SIZE = 10;

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // Fail loudly rather than silently targeting a local database: a missing or
    // misspelled variable must never point the app at the wrong server.
    throw new Error('DATABASE_URL is required but was not set.');
  }
  return url;
}

/**
 * The `pg` driver ignores Prisma's `?schema=` query parameter, so the schema has
 * to be handed to the adapter explicitly. Without it, migrations would use the
 * schema named in the URL while runtime queries fall back to `public`.
 */
export function schemaFromUrl(url: string): string | undefined {
  try {
    const schema = new URL(url).searchParams.get('schema');
    return schema && schema !== 'public' ? schema : undefined;
  } catch {
    return undefined;
  }
}

function createClient(): PrismaClient {
  const connectionString = requireDatabaseUrl();
  const adapter = new PrismaPg(
    {
      connectionString,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      idleTimeoutMillis: IDLE_TIMEOUT_MS,
      max: MAX_POOL_SIZE,
    },
    { schema: schemaFromUrl(connectionString) },
  );
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma: PrismaClient = globalThis.__prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}
