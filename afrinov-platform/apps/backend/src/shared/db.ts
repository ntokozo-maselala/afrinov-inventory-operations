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

/**
 * The longest one SQL statement may run before PostgreSQL cancels it (PRA-18).
 * The HTTP layer gives up on a request after 30 s, but without this the query
 * behind it would keep running and keep one of the ten pool connections busy,
 * so a few runaway reports could starve every other request. Matches the
 * request timeout by default; `DB_STATEMENT_TIMEOUT_MS` overrides it (0 turns
 * it off, e.g. for a one-off import run by hand).
 */
export function statementTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.DB_STATEMENT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 0 && env.DB_STATEMENT_TIMEOUT_MS?.trim() ? raw : 30_000;
}

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
      statement_timeout: statementTimeoutMs(),
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
