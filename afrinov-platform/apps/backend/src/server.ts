import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { randomBytes } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { ApiError, Errors } from './shared/errors.js';
import { loadConfig, ConfigError, resolveCorsOrigin, isKnownInsecureSecret, type AppConfig } from './shared/config.js';
import { prisma } from './shared/db.js';
import { isActiveInDb } from './shared/authorization.js';
import { serviceName, serviceVersion } from './shared/version.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; name: string; roles: string[] };
    user: { sub: string; email: string; name: string; roles: string[] };
  }
}

export interface BuildServerOptions {
  skipConfigValidation?: boolean;
}

export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const config = opts.skipConfigValidation ? loadConfigUnsafe() : loadConfigOrThrow();

  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: config.nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
    },
    bodyLimit: 1_000_000,
    requestTimeout: 30_000,
    pluginTimeout: config.nodeEnv === 'test' ? 60_000 : 10_000,
  });

  // Per-request correlation ID so logs can be traced through async boundaries.
  //
  // HTTP request/response logging (timestamp, requestId, method, url,
  // statusCode, responseTime) is provided by Fastify's built-in pino request
  // logger, which is enabled above via the `logger` option. It emits an
  // "incoming request" line on arrival and a "request completed" line on
  // completion, carrying the request id for correlation. No additional
  // per-request hook is required, and none is added so logs are not duplicated.
  app.addHook('onRequest', async (req) => {
    req.id = req.id || crypto.randomUUID();
  });

  // CORS is allow-list based in every environment. `CORS_ORIGIN` (comma
  // separated) is the explicit list; development with no list falls back to the
  // local dev-server origins. Reflecting the request origin together with
  // `credentials: true` would let any website make credentialed cross-origin
  // calls to this API, so it is only reachable via the explicit
  // CORS_ALLOW_ANY=true opt-in. See resolveCorsOrigin() in shared/config.ts.
  const corsOrigin = resolveCorsOrigin(
    config.nodeEnv,
    process.env.CORS_ORIGIN,
    process.env.CORS_ALLOW_ANY,
  );
  await app.register(cors, { origin: corsOrigin, credentials: true });

  // Security headers (Strict-Transport-Security, X-Content-Type-Options,
  // Referrer-Policy, CSP framing policy). CORP/COOP/COEP are disabled so the
  // CORS-controlled API responses are not blocked for the SPA frontend; a
  // response CSP does not gate cross-origin fetch (the requesting page's CSP
  // governs connect-src), and downloads are served as attachments.
  await app.register(helmet, {
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
  });

  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: { expiresIn: '12h' },
  });

  // Rate limiting: strict on authentication endpoints (brute-force/credential-
  // stuffing protection), generous on everything else (flood protection). Limits
  // are env-overridable (RATE_LIMIT_AUTH / RATE_LIMIT_GLOBAL) so operators can
  // tune, and generous in the test environment so legitimate flows are not 429'd.
  const isTest = config.nodeEnv === 'test';
  const envAuth = Number(process.env.RATE_LIMIT_AUTH);
  const envGlobal = Number(process.env.RATE_LIMIT_GLOBAL);
  const authLimit = envAuth > 0 ? envAuth : isTest ? 1000 : 5;
  const globalLimit = envGlobal > 0 ? envGlobal : isTest ? 10000 : 1000;
  const STRICT_AUTH_PATHS = new Set(['/api/v1/auth/login', '/api/v1/auth/register']);
  await app.register(rateLimit, {
    // `req.url` is the raw request target and includes the query string, so an
    // exact-match test would let `/api/v1/auth/login?x=1` fall through to the
    // far more permissive global budget. Compare on the path only.
    max: (req) => (STRICT_AUTH_PATHS.has(pathnameOf(req.url)) ? authLimit : globalLimit),
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    addHeaders: { 'x-ratelimit-remaining': true, 'x-ratelimit-reset': true, 'retry-after': true },
    // @fastify/rate-limit *throws* whatever this returns, and a thrown plain
    // object is not an Error, so it used to fall through the error handler to a
    // generic 500 INTERNAL_ERROR. Throttling was still enforced, but clients
    // and monitoring saw a server fault instead of a 429 and kept retrying.
    // Returning an ApiError keeps the documented error contract intact.
    errorResponseBuilder: () => Errors.rateLimited(),
  });

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    // Only the token verification itself may be answered with 401. A failure of
    // the database lookup below is an availability fault, not a bad credential;
    // it must not be reported as an authentication failure, or a database
    // outage is silently disguised as a wave of invalid tokens (and the
    // incident is invisible in the logs).
    let payload: { sub: string; email: string; name: string; roles: string[] };
    try {
      await req.jwtVerify();
      payload = req.user as typeof payload;
    } catch {
      return reply.code(401).send({
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
      });
    }

    if (!payload?.sub) {
      return reply.code(401).send({
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
      });
    }

    // DB-authoritative account status: revocation is immediate rather than
    // waiting out the remaining token lifetime. The lookup is memoised per
    // request, so the authorization layer reuses this result instead of
    // repeating the identical primary-key query. A lookup error propagates to
    // the error handler (500) — access is never granted on an unknown state.
    const active = await isActiveInDb(payload.sub, req);
    if (!active) {
      return reply.code(401).send({
        error: { code: 'UNAUTHENTICATED', message: 'Account unavailable' },
      });
    }
    (req as unknown as { user: typeof payload & { id: string; active: boolean } }).user = {
      ...payload,
      id: payload.sub,
      active,
    };
  });

  app.setErrorHandler((err, req, reply) => {
    const requestId = req.id;
    if (err instanceof ApiError) {
      req.log.warn(
        { requestId, code: err.code, message: err.message, statusCode: err.statusCode },
        'ApiError',
      );
      return reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }
    if (err instanceof Error) {
      app.log.error({ err, requestId }, 'Unhandled error');
      return reply.code(500).send({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
    }
    app.log.error({ requestId }, 'Non-Error thrown in handler');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  // Service/API identification: answers whether this backend process is running.
  app.get('/', async () => ({
    status: 'ok',
    service: serviceName,
    message: 'Afrinov backend is running',
    environment: config.nodeEnv,
    version: serviceVersion,
  }));

  // Liveness: answers whether the process is alive.
  app.get('/health', async () => ({ status: 'ok', time: new Date().toISOString() }));

  // Readiness: verifies the database connection pool has a live connection.
  app.get('/health/ready', async (req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.send({ status: 'ready', database: 'connected', time: new Date().toISOString() });
    } catch (err) {
      app.log.error({ err }, 'Readiness check failed');
      return reply.code(503).send({ status: 'not_ready', database: 'error', time: new Date().toISOString() });
    }
  });

  await app.register(async (instance) => {
    const { authRoutes } = await import('./modules/identity/auth.routes.js');
    const { userRoutes } = await import('./modules/identity/user.routes.js');
    const { materialRoutes, locationRoutes } = await import('./modules/inventory/material.routes.js');
    const { stockItemRoutes } = await import('./modules/inventory/stock-item.routes.js');
    const { rackRoutes } = await import('./modules/inventory/rack.routes.js');
    const { inventoryRoutes } = await import('./modules/inventory/inventory.routes.js');
    const { procurementRoutes } = await import('./modules/procurement/procurement.routes.js');
    const { projectRoutes } = await import('./modules/operations/project.routes.js');
    const { reportingRoutes } = await import('./modules/reporting/reporting.routes.js');
    const { settingsRoutes } = await import('./modules/settings/settings.routes.js');
    const { auditRoutes } = await import('./modules/audit/audit.routes.js');
    const { healthRoutes } = await import('./modules/health/health.routes.js');

    await authRoutes(instance);
    await userRoutes(instance);
    await materialRoutes(instance);
    await locationRoutes(instance);
    await stockItemRoutes(instance);
    await rackRoutes(instance);
    await inventoryRoutes(instance);
    await procurementRoutes(instance);
    await projectRoutes(instance);
    await reportingRoutes(instance);
    await settingsRoutes(instance);
    await auditRoutes(instance);
    await healthRoutes(instance);
  }, { prefix: '/api/v1' });

  return app;
}

// Lightweight config load for tests that don't want strict env validation.
function loadConfigOrThrow() {
  return loadConfig();
}

// Strip the query string (and any fragment) from a raw request target so
// route-identity comparisons are not defeated by `?`-suffixes.
function pathnameOf(url: string): string {
  const q = url.indexOf('?');
  const h = url.indexOf('#');
  let end = url.length;
  if (q !== -1) end = q;
  if (h !== -1 && h < end) end = h;
  return url.slice(0, end);
}

// Generated once per process so that a server instance can still verify tokens
// it issued itself, while never matching a value that exists in this
// repository or in any other deployment.
let ephemeralJwtSecret: string | undefined;

function ephemeralJwtSecretValue(): string {
  if (!ephemeralJwtSecret) {
    ephemeralJwtSecret = randomBytes(32).toString('base64url');
  }
  return ephemeralJwtSecret;
}

function loadConfigUnsafe(): AppConfig {
  // Used only by tests and local diagnostic tooling (skipConfigValidation).
  // Production bootstrap MUST go through loadConfig(), which rejects insecure
  // secrets; never construct an insecure config in a production process.
  //
  // The allow-list is explicit rather than "anything except production",
  // because loadConfig() treats an UNSET NODE_ENV as production (fail-closed).
  // A deny-list here would treat the same unset value as safe and re-open the
  // exact bypass this guard exists to close.
  const rawNodeEnv = process.env.NODE_ENV;
  if (rawNodeEnv !== 'test' && rawNodeEnv !== 'development') {
    throw new ConfigError(
      'skipConfigValidation is permitted only when NODE_ENV is "test" or "development". ' +
        'Production processes must boot through loadConfig().',
    );
  }
  const nodeEnv: AppConfig['nodeEnv'] = rawNodeEnv;
  // Never fall back to a literal secret: a value committed to this repository
  // is a public value. An unset JWT_SECRET in a test/dev process gets a random
  // per-process key instead.
  const configuredSecret = process.env.JWT_SECRET;
  const jwtSecret =
    configuredSecret && !isKnownInsecureSecret(configuredSecret)
      ? configuredSecret
      : ephemeralJwtSecretValue();

  return {
    nodeEnv,
    port: Number(process.env.PORT ?? 4000),
    host: process.env.HOST ?? '0.0.0.0',
    databaseUrl: process.env.DATABASE_URL ?? '',
    jwtSecret,
    logLevel: process.env.LOG_LEVEL ?? 'info',
  };
}

let shuttingDown = false;

export async function start(): Promise<void> {
  const config = loadConfig();

  const app = await buildServer();
  const port = config.port;
  const host = config.host;

  // ── Startup observability ────────────────────────────────────────────────
  // Emit a clear, ordered startup trace so it is always possible to tell
  // whether the process bootstrapped and bound its socket. Never fabricate
  // success: the database probe result is logged only after the probe runs.
  app.log.info('Backend starting');
  app.log.info(`Environment: ${config.nodeEnv}`);
  app.log.info(`Node version: ${process.version}`);
  app.log.info(`Process ID: ${process.pid}`);
  app.log.info('Configuration loaded');

  // Best-effort database connectivity probe. This is non-blocking: the HTTP
  // server must still start so that /health reports process liveness; /health/ready
  // independently reflects database availability. We only log the outcome here.
  app.log.info('Database initialization started');
  try {
    await prisma.$queryRaw`SELECT 1`;
    app.log.info('Database connection established');
  } catch (err) {
    app.log.error({ err: (err as Error).message }, 'Database connection failed');
  }

  // Graceful shutdown: stop accepting connections, drain in-flight requests,
  // close the database pool, then exit.
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Received ${signal}, shutting down gracefully…`);
    try {
      await app.close();
      await prisma.$disconnect();
      app.log.info('Graceful shutdown complete.');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  app.log.info('HTTP server starting');
  try {
    await app.listen({ port, host });
    app.log.info('HTTP server listening');
    app.log.info(`Host: ${host} (reachable at http://localhost:${port})`);
    app.log.info(`Port: ${port}`);
    app.log.info(`Base URL: http://localhost:${port}`);
    app.log.info(`Health endpoint: http://localhost:${port}/health`);
    app.log.info(`Readiness endpoint: http://localhost:${port}/health/ready`);
    app.log.info('Backend startup complete');
  } catch (err) {
    app.log.error({ err }, 'Failed to start server');
    await prisma.$disconnect();
    process.exit(1);
  }
}
