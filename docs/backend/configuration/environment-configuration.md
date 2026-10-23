# Environment and configuration model

## Configuration sources by mode

Configuration is read from `process.env`. `src/shared/config.ts` validates
core server settings; Prisma reads `DATABASE_URL` from the datasource
declaration in `prisma/schema.prisma`. Feature flags and operational options
are read directly by their consumers. The server process does not load `.env`
itself.

| Mode | How values enter the process | Database behavior | Important differences |
| --- | --- | --- | --- |
| Development | `npm run dev` invokes `tsx --env-file=.env`; `.env.example` is a template only. | Local Postgres is normally started separately. The startup probe logs failures but does not stop listener startup. | Pretty Pino transport; local CORS allow-list fallback; API docs on unless disabled; procurement on unless explicitly false. |
| Unit test | Vitest uses `src/**/*.test.ts`; its config supplies a dummy URL only if `DATABASE_URL` is absent. Tests generally mock Prisma. | Does not require PostgreSQL for the unit suite. `src/db/migrations.test.ts` reads SQL files; it does not execute them. | `NODE_ENV` is set by tests as needed; rate limits use high defaults when `NODE_ENV=test`; plugin timeout is 60s. |
| Integration test | Integration config reads the backend `.env` file (if present), then forces `NODE_ENV=development`. CI injects an ephemeral Postgres URL and random secrets. | Runs real HTTP against the DB target and leaves rows behind. The checked-in `.env.test.example` is not automatically loaded by the integration config. | Must be explicitly pointed at a disposable test DB. Do not use a production or valuable development DB. |
| CI | `.github/workflows/backend-ci.yml` uses a throwaway PostgreSQL 16 service for the integration job. | Applies migrations and seed to a per-job DB. | Both jobs choose Node 20; installed Vitest 5 requires Node 22.12+ by its package engine declaration. |
| Compose | Values are interpolated/injected by Docker Compose. | PostgreSQL 16 service uses named volume; backend waits for health, then applies migrations and runs the demo seed. | `NODE_ENV` defaults to production; JWT secret required; CORS disabled when origin list absent; Swagger off by default. Image build is not verified. |
| Staging | No staging-specific file or workflow found. | Unknown; operator must provide DB and credentials. | `loadConfig()` does not reject arbitrary `NODE_ENV` strings, even though its TypeScript type and README list only development/test/production. |

The backend's required environment variables are not validated as one schema
at boot: `DATABASE_URL`, `JWT_SECRET`, and `PORT` are checked in
`loadConfig()`, while feature flags and operational variables are interpreted
by consumers. Several comments/README statements describe stronger policy than
the code enforces. See the findings register for the verified gaps.

## Environment variable matrix

No secret values are included below. `.env.example` contains a public
placeholder for `JWT_SECRET`; it is not a safe credential. The separate
`.env.test.example` describes a test database, but the integration config reads
`.env`, not `.env.test`.

| Variable or setting | Purpose | Consumer | Required? | Default or fallback | Development | Test | Production | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL | `loadConfig`; Prisma datasource | Yes | None; empty fails config | `.env.example` points at local DB | Unit Vitest uses a dummy URL if unset; integration loads `.env`; CI injects disposable DB | Injected by Compose/runtime | Only non-empty checked by `loadConfig`; URL syntax/connectivity not validated until query |
| `JWT_SECRET` | HMAC signing and verification key | `loadConfig`, `@fastify/jwt` plugin | Yes | None; empty fails | Example value is a public placeholder; code permits known placeholders outside production | Test example uses known test-only value; unit tests may use per-process ephemeral secret with `skipConfigValidation` | Compose requires supplied value; known exact placeholders rejected only when `NODE_ENV=production` | Non-empty required; exact blocklist for production; no length/entropy enforcement |
| `NODE_ENV` | Runtime mode selection | `config.ts`, `server.ts`, `db.ts`, seed, settings, tests | No | `production` | Normally `development` via `.env` | Unit environment controlled by Vitest; integration config overwrites to `development` | Compose defaults `production` | TypeScript cast only; arbitrary strings accepted, affecting security and docs defaults |
| `PORT` | HTTP listener port | `loadConfig`, `server.start()` | No | `4000` | Example `4000` | Example `4000`; integration binds its test server to port `0` directly | Compose sets `4000` | Finite numeric value in 1..65535 |
| `HOST` | Listener interface | `loadConfig`, `server.start()` | No | `0.0.0.0` | Example `0.0.0.0` | Example `127.0.0.1`; integration binds `127.0.0.1` directly | Compose does not override | No validation |
| `LOG_LEVEL` | Pino threshold | Fastify logger in `server.ts` | No | `info` | `pino-pretty` transport, level configurable | Example `silent`; tests can override | `info` unless injected | Passed to Pino; no app-level enum check |
| `CORS_ORIGIN` | Comma-separated browser-origin allow-list | `resolveCorsOrigin`, `@fastify/cors` | No at boot; operationally needed for browser UI outside dev | Local dev origin list in development; otherwise CORS disabled | Explicit list wins; known local Vite origins if unset | False unless explicitly set; integration auth suite sets test origin | Compose defaults empty (CORS disabled) | Split/trim/filter; no URL validation |
| `CORS_ALLOW_ANY` | Explicit any-origin CORS escape hatch | `resolveCorsOrigin` | No | Disabled | `true` returns wildcard policy | Same | Same; code does not reject it in production | Exact lowercase string `true`; not restricted by `NODE_ENV` |
| `RATE_LIMIT_AUTH` | Login requests/minute/IP | Rate-limit plugin in `server.ts` | No | 5 (1000 in tests) | Positive numeric override | 1000 fallback | 5 fallback | `Number()` then used only when `>0`; nonpositive/NaN falls back |
| `RATE_LIMIT_GLOBAL` | Other requests/minute/IP | Rate-limit plugin | No | 1000 (10000 in tests) | Positive numeric override | 10000 fallback | 1000 fallback | Same positive-number fallback; no shared store configured in source |
| `PROCUREMENT_ENABLED` | Toggle purchase-order/goods-receipt routes | `isProcurementEnabled`, `server.ts` | No | Enabled unless string is `false` | Enabled by default | Enabled unless test override | Enabled by default | Case-insensitive exact `false`; supplier routes remain mounted |
| `API_DOCS_ENABLED` | Toggle `/api/docs` and OpenAPI JSON | `isApiDocsEnabled`, `server.ts` | No | Enabled except when mode is exactly `production` | On by default | On by default | Off by default | Case-insensitive exact `true`/`false`; other values use mode fallback |
| `SEED_ADMIN_PASSWORD` | Password for bootstrap admin creation and explicit rotation input | `src/db/seed.ts`, rotation script, integration helpers | Not server boot; required for every production seed invocation by current code | Unset dev/test generates an unlogged random password | Seed can create an admin without a known login unless supplied | Integration needs it to log in | Production seed checks for a nonblank value before checking whether the admin exists; Compose comments incorrectly describe it as first-create-only | Whitespace-only treated missing; rotation requires 8+ chars |
| `SEED_ADMIN_EMAIL` | Account email for integration/diagnostics | Integration helpers and diagnostic script | No | `admin@afrinov.local` | Can point tooling at another account | CI uses seed admin default | Not used by API startup or seed (seed email is fixed) | No validation outside consumer |
| `REPORT_CURRENCY` | Currency label for inventory report | `modules/reporting/report.service.ts` | No | `ZAR` | Same | Same | Same | No validation found; other reports use settings instead |
| `POSTGRES_USER` | Compose DB user | `docker-compose.yml` | No | `afrinov` | Compose-only | CI workflow sets separately | Compose-only | Compose interpolation |
| `POSTGRES_PASSWORD` | Compose DB password | Compose DB and assembled backend URL | Yes for Compose | No default; Compose errors if unset | Local/demo default value is documented only in comments, not embedded as actual default | CI uses throwaway value in workflow | Supply via protected environment/secret mechanism; do not put in committed files | Compose required interpolation; secret strength not checked here |
| `POSTGRES_DB` | Compose DB name | Compose DB and backend URL | No | `afrinov` | Compose-only | CI uses `afrinov_test` | Compose-only | Compose interpolation |
| `VITE_PROCUREMENT_ENABLED` | Frontend's matching UI flag | Frontend build/runtime | Not a backend variable | Frontend-specific | Keep aligned with `PROCUREMENT_ENABLED` | Test/UI setting | Keep aligned with backend feature flag | Not consumed by backend |

## Key configuration caveats

- The code's `NODE_ENV` default is fail-closed for an unset value (it treats
  it as production), but arbitrary non-production strings are not rejected.
  A `staging` value therefore bypasses production-only JWT placeholder
  rejection and enables API docs by default.
- Production JWT validation checks a small list of exact published
  placeholders. A one-character secret was accepted by direct reproduction;
  no strength, length, or entropy policy exists in `loadConfig()`.
- `CORS_ALLOW_ANY=true` is accepted in production and CORS is configured with
  credentials. Its comments call it a demo escape hatch but code does not
  enforce that restriction.
- `CORS_ORIGIN` is described as required for production in the README/example,
  but startup does not enforce it. When absent outside development, browser
  CORS is disabled, which may make a deployed SPA unable to call the API.
- The Prisma client connects lazily; a valid-looking `DATABASE_URL` is not
  proof of connectivity. Use `/health/ready` against the intended DB.
- `DATABASE_URL`, JWT keys, seed credentials, and interpolated passwords must
  never be copied into reports or committed `.env` files.

See [environment-variable reference](environment-variable-reference.md) for a
short operational index and [runbook](../operations/runbook.md) for safe setup.
