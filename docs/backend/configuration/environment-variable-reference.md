# Environment variable reference

This is a quick lookup. The full environment matrix and exact behavior are in
[environment-configuration.md](environment-configuration.md). Values are
deliberately omitted where a variable may contain credentials.

| Variable | Consumer | Safe description / default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | Prisma datasource and config validation | PostgreSQL URL; no default | Required; use separate disposable DB for integration tests. |
| `JWT_SECRET` | Fastify JWT plugin | Random secret injected at runtime | Required; current validator rejects exact known placeholders only in production. |
| `NODE_ENV` | Config, logging, docs, CORS, seed | Defaults to `production` | Intended values: `development`, `test`, `production`; arbitrary strings are currently accepted. |
| `PORT` | Fastify listener | `4000` | Must be 1–65535. |
| `HOST` | Fastify listener | `0.0.0.0` | Bind interface; no validation. |
| `LOG_LEVEL` | Pino | `info` | Development uses pretty transport. |
| `CORS_ORIGIN` | CORS plugin | Local Vite allow-list in development; disabled elsewhere if unset | Comma-separated explicit origins. |
| `CORS_ALLOW_ANY` | CORS resolver | Disabled | `true` permits any origin with credentials in every environment. |
| `RATE_LIMIT_AUTH` | Login rate limit | 5 requests/minute/IP; 1000 in unit-test mode | Positive number overrides; default key is separated from global API counter. |
| `RATE_LIMIT_GLOBAL` | Global rate limit | 1000 requests/minute/IP; 10000 in unit-test mode | Positive number overrides. |
| `PROCUREMENT_ENABLED` | Server route registration | Enabled unless value is `false` | Disables purchase orders and goods receipts, not supplier routes. |
| `API_DOCS_ENABLED` | Swagger/OpenAPI routes | Enabled outside exact `production` mode | Set true/false explicitly when needed. |
| `SEED_ADMIN_PASSWORD` | Seed, admin rotation, integration login | Not a server setting | Current production seed requires it on every invocation; rotation is a database write. |
| `SEED_ADMIN_EMAIL` | Integration and diagnostics | `admin@afrinov.local` | Does not change the email used by the seed. |
| `REPORT_CURRENCY` | Inventory report | `ZAR` | Other reports read configured settings. |
| `POSTGRES_USER` | Docker Compose | `afrinov` | Compose interpolation only. |
| `POSTGRES_PASSWORD` | Docker Compose | No default | Required by Compose; supply through a secret mechanism. |
| `POSTGRES_DB` | Docker Compose | `afrinov` | Compose interpolation only. |
| `VITE_PROCUREMENT_ENABLED` | Frontend only | Frontend-specific | Keep aligned with backend feature flag. |

### Safe sample setup

Use `.env.example` as a template and replace its JWT placeholder before
starting. Do not include credential values in audit reports. The checked-in
`.env.test.example` is not automatically read by the integration test config;
set the disposable test database URL explicitly or copy it to the exact
`.env` path only after verifying the target.
