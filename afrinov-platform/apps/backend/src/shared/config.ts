// Centralized environment configuration and validation.
//
// Startup validation fails fast on missing required variables so misconfiguration
// is caught before the server accepts traffic instead of failing on the first
// request. Production-insecure defaults (e.g. a guessable JWT secret) are flagged.
//
// Required env vars:
//   DATABASE_URL  – Prisma connection string (always required; the app cannot
//                   function without a database).
//   JWT_SECRET    – Secret used to sign JWT tokens. Must be non-empty. In
//                   production a known-insecure default is rejected.
export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  host: string;
  databaseUrl: string;
  jwtSecret: string;
  logLevel: string;
}

// Secrets that are publicly known because they are committed to this
// repository. They must never sign a production token.
//
// The entries include values that appear in the committed `.env.example` /
// `.env.test.example` files. Anyone with repository access can read them, so
// accepting one in production would hand out forgeable authentication tokens
// for the lifetime of the deployment.
const INSECURE_SECRETS = new Set([
  '',
  'insecure-dev-secret-change-me',
  'change-me-in-production',
  'change-me-in-production-please',
  'test-secret-do-not-use-in-prod',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'REPLACE_WITH_RANDOM_SECRET_generate_one_above',
]);

export function isKnownInsecureSecret(secret: string): boolean {
  return INSECURE_SECRETS.has(secret);
}

export function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV ?? 'production') as AppConfig['nodeEnv'];

  const databaseUrl = process.env.DATABASE_URL ?? '';
  const jwtSecret = process.env.JWT_SECRET ?? '';

  if (!databaseUrl) {
    throw new ConfigError('DATABASE_URL is required but was not set.');
  }

  if (!jwtSecret || INSECURE_SECRETS.has(jwtSecret)) {
    if (nodeEnv === 'production') {
      throw new ConfigError(
        'JWT_SECRET must be set to a strong, random value in production. ' +
        'The default / placeholder secret is not permitted.',
      );
    }
    if (!jwtSecret) {
      throw new ConfigError('JWT_SECRET is required but was not set.');
    }
  }

  const port = Number(process.env.PORT ?? 4000);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new ConfigError(`PORT must be a valid port number (got "${process.env.PORT}").`);
  }

  return {
    nodeEnv,
    port,
    host: process.env.HOST ?? '0.0.0.0',
    databaseUrl,
    jwtSecret,
    logLevel: process.env.LOG_LEVEL ?? 'info',
  };
}

/**
 * Whether the procurement module (purchase orders and goods receipts) is
 * enabled. Off unless `PROCUREMENT_ENABLED=true`; when off, its API routes are
 * not registered and respond 404. Supplier routes are unaffected.
 */
export function isProcurementEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.PROCUREMENT_ENABLED ?? '').toLowerCase() === 'true';
}

/**
 * Whether to serve the API docs at /api/docs. `API_DOCS_ENABLED=true|false`
 * decides when set; otherwise they are on everywhere except production, where
 * publishing the full API surface should be a deliberate choice.
 */
export function isApiDocsEnabled(nodeEnv: AppConfig['nodeEnv'], env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = String(env.API_DOCS_ENABLED ?? '').toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return nodeEnv !== 'production';
}

// Origins the local Vite dev server and common SPA dev hosts are served from.
// These are the only origins permitted when CORS_ORIGIN is not configured
// during development. Reflection of arbitrary origins is never the default.
const DEV_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

export type CorsOriginSetting = string[] | boolean;

/**
 * Resolve the `@fastify/cors` origin policy.
 *
 * - `CORS_ORIGIN` is an explicit allow-list and always wins, in every
 *   environment. An operator who lists origins gets exactly those origins.
 * - Development with no `CORS_ORIGIN` falls back to the local dev-server
 *   allow-list. It does NOT reflect the request origin: reflecting arbitrary
 *   origins together with `credentials: true` hands any website on the
 *   internet a credentialed cross-origin channel to this API.
 * - Anything else (production/test with no `CORS_ORIGIN`) disables CORS
 *   entirely, which is fail-closed.
 * - `CORS_ALLOW_ANY=true` is an explicit, opt-in escape hatch for operators
 *   who genuinely need a wildcard (e.g. a throwaway demo box).
 */
export function resolveCorsOrigin(
  nodeEnv: 'development' | 'test' | 'production',
  rawCorsOrigin: string | undefined,
  allowAny: string | undefined,
): CorsOriginSetting {
  if (allowAny === 'true') return true;

  const configured = rawCorsOrigin
    ?.split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  if (configured && configured.length > 0) return configured;
  if (nodeEnv === 'development') return DEV_ALLOWED_ORIGINS;
  return false;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
