# @afrinov/backend

REST API for the Afrinov Inventory & Operations Platform: inventory ledger,
procurement, projects, reporting, settings and audit, behind JWT
authentication and role-based permissions.

Stack: Node.js 20, Fastify 5, TypeScript, Prisma 5, PostgreSQL 16, Zod, Vitest.

## Running it locally

Requirements: Node.js 22 or later (24 recommended; the test tools need 22+), npm, and Docker (for PostgreSQL).

Commands below use Git Bash / macOS / Linux syntax. In PowerShell, set a
variable for one command with `$env:NAME = "value"; <command>`.

1. Install dependencies from the workspace root (`afrinov-platform/`):

   ```sh
   npm install
   ```

2. In `apps/backend`, create your environment file and generate a JWT secret:

   ```sh
   cp .env.example .env
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

   Paste the printed value into `JWT_SECRET` in `.env`.

3. Start PostgreSQL. The password must match the one in `DATABASE_URL`
   (`afrinov` in `.env.example`):

   ```sh
   POSTGRES_PASSWORD=afrinov docker compose up -d db
   ```

4. Generate the Prisma client, apply migrations and load the demo data:

   ```sh
   npx prisma generate
   npm run db:migrate
   SEED_ADMIN_PASSWORD=choose-a-password npm run db:seed
   ```

   The seed creates the admin account `admin@afrinov.local` with that
   password. Without `SEED_ADMIN_PASSWORD` it generates a random password and
   does not print it, so you will not be able to log in. The seed is safe to
   re-run.

5. Start the API with hot reload:

   ```sh
   npm run dev
   ```

   It listens on <http://localhost:4000>. Check
   <http://localhost:4000/health/ready>: it returns `"database": "connected"`
   when the API can reach PostgreSQL. The API docs are at
   <http://localhost:4000/api/docs>.

## Running it with Docker

`docker-compose.yml` runs PostgreSQL and the API together. On start the API
container applies migrations, runs the seed, then starts the server. From
`apps/backend`:

```sh
POSTGRES_PASSWORD=<db password> \
JWT_SECRET=<generated secret> \
SEED_ADMIN_PASSWORD=<admin password> \
CORS_ORIGIN=http://localhost:5173 \
docker compose up --build
```

The container runs with `NODE_ENV=production`, so the stricter production
rules apply: `JWT_SECRET` must be a real random value, `SEED_ADMIN_PASSWORD`
is required on first start, CORS is disabled unless `CORS_ORIGIN` is set, and
the API docs are off unless `API_DOCS_ENABLED=true`.

## Environment variables

`.env.example` documents each one in more detail.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | Signs login tokens. Placeholder values are rejected in production |
| `NODE_ENV` | No | `production` | `development`, `test` or `production` |
| `PORT` | No | `4000` | HTTP port |
| `HOST` | No | `0.0.0.0` | Interface to bind |
| `LOG_LEVEL` | No | `info` | Pino log level |
| `CORS_ORIGIN` | In production | Local Vite origins in development | Comma-separated list of allowed browser origins |
| `CORS_ALLOW_ANY` | No | — | `true` allows any origin. Throwaway demos only |
| `RATE_LIMIT_AUTH` | No | `5` | Login/register requests per minute per IP |
| `RATE_LIMIT_GLOBAL` | No | `1000` | All other requests per minute per IP |
| `PROCUREMENT_ENABLED` | No | `false` | `true` turns on purchase orders and goods receipts. Keep in step with the frontend's `VITE_PROCUREMENT_ENABLED` |
| `API_DOCS_ENABLED` | No | On, except in production | `true` or `false` to serve the API docs at `/api/docs` |
| `SEED_ADMIN_PASSWORD` | In production | Random | Admin password the seed sets when it first creates the account |
| `SEED_ADMIN_EMAIL` | No | `admin@afrinov.local` | Account used by the integration tests and diagnostic scripts |
| `REPORT_CURRENCY` | No | `ZAR` | Currency code returned with inventory report values |

## Scripts

Run from `apps/backend`.

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the API with hot reload, reading `.env` |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled API |
| `npm run typecheck` | Type-check `src/`, `integration/` and `scripts/` without emitting files |
| `npm run lint` | Run ESLint on `src/`, `integration/` and `scripts/` |
| `npm test` | Run the unit tests |
| `npm run test:integration` | Run the integration tests against a real database |
| `npm run db:migrate` | Apply pending Prisma migrations |
| `npm run db:seed` | Load roles, permissions, the admin account and demo data |
| `npm run import:workbook -- --file <workbook.xlsm>` | Dry run of the stock workbook import: checks the four Main and four Summary sheets against the mapping file and writes a problem report to `import-reports/` (git-ignored). The first run creates `import-reports/mapping.xlsx` (new SKUs, units, locations) for the storeman to review; later runs read it. Never touches the database |
| `npm run diag:login` | Log in as the seed admin through the full server and print the result. Needs `.env` with `SEED_ADMIN_PASSWORD` |
| `npm run diag:admin` | Print whether the seed admin exists, is active, its roles, and every user's email and status. Needs `.env` |

The two `diag:` scripts live in `scripts/`, outside the build, and refuse to
run when `NODE_ENV=production`.

## Tests

- **Unit tests** (`src/**/*.test.ts`) mock the database and need no setup:
  `npm test`.
- **Integration tests** (`integration/`) start the real server and talk to a
  real PostgreSQL database. Migrate and seed a database first, then run them
  with the same admin password the seed used:

  ```sh
  SEED_ADMIN_PASSWORD=<admin password> npm run test:integration
  ```

## Continuous integration

`.github/workflows/backend-ci.yml` runs on every pull request that touches the
backend and on every push to `main`:

- **Checks:** typecheck, lint, unit tests and build.
- **Integration:** migrates and seeds a throwaway PostgreSQL 16 container,
  then runs the integration tests.

## Code layout

```
prisma/
  schema.prisma        Database schema
  migrations/          SQL migrations, applied in name order
integration/           Tests against a real server and database
scripts/               Developer diagnostics and the workbook import, not part of the build
src/
  index.ts             Entry point: validates config, then starts the server
  server.ts            Fastify setup: CORS, security headers, JWT, rate limits, routes
  db/                  Migration runner and seed
  openapi/             The OpenAPI document served at /api/docs
  shared/              Config, errors, permissions, authorization, Prisma client
  modules/
    identity/          Login, registration, users and roles
    inventory/         Materials, locations, racks, stock items, stock movements, balances
    procurement/       Suppliers, purchase orders, goods receipts
    operations/        Projects
    migration/         Reading and checking the stock workbook for the data import
    reporting/         Stock, movement, low-stock and project reports; Excel/PDF export
    settings/          Typed application settings
    audit/             Audit log
    health/            Health checks
```

Each module keeps its HTTP routes in `*.routes.ts` and its business logic in
`*.service.ts`.

Stock balances are never written directly. Every stock change is recorded in
the inventory transaction ledger, and balances are recalculated from it.

## API

The full reference is served by the API itself: Swagger UI at `/api/docs`, and
the OpenAPI 3 document at `/api/docs/json` for generating clients. It lists
every endpoint with its request body, query parameters, required permission
and status codes. Response bodies are not described yet.

The request bodies in the docs come from the same Zod schemas the routes
validate with. When you add an endpoint, add it to `OPERATIONS` in
`src/openapi/document.ts`; a unit test fails until the docs and the
registered routes match.

Endpoints are under `/api/v1`; the health checks are also served at the root
(`/health`, `/health/ready`). Everything except login, registration and the
health checks needs an `Authorization: Bearer <token>` header, using the token
returned by `POST /api/v1/auth/login`.

| Area | Endpoints |
| --- | --- |
| Auth | `/auth/login`, `/auth/register`, `/auth/me` |
| Users | `/users` |
| Inventory | `/materials`, `/locations`, `/racks`, `/stock-items`, `/inventory-transactions`, `/inventory-issues`, `/inventory-transfers`, `/inventory-adjustments` |
| Procurement | `/suppliers`; `/purchase-orders` and `/goods-receipts` only when `PROCUREMENT_ENABLED=true` |
| Projects | `/projects` |
| Reports | `/reports/current-stock`, `/reports/movement-history`, `/reports/low-stock`, `/reports/project-consumption/:projectNumber`, `/reports/inventory`, `/reports/inventory/export` |
| Settings | `/settings` |
| Audit | `/audit` |
| Health | `/health` (process is up), `/health/ready` (database is reachable) |

Errors use one shape: `{ "error": { "code", "message", "details" } }`.

Permissions are checked on the server. The roles are `ADMIN`,
`STORE_CONTROLLER`, `PROCUREMENT`, `APPROVER`, `TECHNICIAN` and `VIEWER`;
`src/shared/permissions.ts` maps each role to what it may do.

Self-registration (`POST /auth/register`) is off until an admin turns on
"Allow self-registration" in Settings (`security.allowSelfRegistration`).
Self-registered users get `VIEWER`.
