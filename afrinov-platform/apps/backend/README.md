# @afrinov/backend

REST API for the Afrinov Inventory & Operations Platform: inventory ledger,
procurement, projects, reporting, settings and audit, behind JWT
authentication and role-based permissions.

Stack: Node.js, Fastify 5, TypeScript, Prisma 5, PostgreSQL 16, Zod, Vitest.
The Docker image and backend/frontend CI use Node 24. Local development and
Vitest checks require Node 22.12 or later (see below).

*Reviewed against the current working tree: 2026-10-23.*

## Running it locally

Requirements: Node.js 22.12 or later (24 recommended), npm, and Docker (for PostgreSQL).

Commands below use Git Bash / macOS / Linux syntax. In PowerShell, set a
variable for one command with `$env:NAME = "value"; <command>`.

1. Install dependencies from the workspace root (`afrinov-platform/`):

   ```sh
   npm ci
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
   npm run db:generate
   npm run db:migrate
   SEED_ADMIN_PASSWORD=choose-a-password npm run db:seed:demo
   ```

   The seed creates the admin account `admin@afrinov.local` with that
   password, which must be changed at the first sign-in (at least 12
   characters). An unset, empty, or whitespace-only `SEED_ADMIN_PASSWORD`
   makes the seed generate a random password and not print it, so you will
   not be able to log in. Production seeding rejects those values. The seed
   does not change an existing admin password, and needs
   `SEED_ADMIN_PASSWORD` only while the admin does not exist yet.

   `npm run db:seed` writes only the bootstrap (permissions, roles, the admin
   and the settings catalog). `npm run db:seed:demo` adds the demo suppliers,
   materials, projects, orders and stock movements, and refuses unless
   `NODE_ENV` is `development` or `test` (ADR-022): demo data never goes into
   a production database.

To rotate the existing bootstrap admin password, set a new `SEED_ADMIN_PASSWORD`
and run `npm run db:rotate-admin`. This updates `admin@afrinov.local` and records
the rotation in the audit log. Use this after deploying the empty-value fix if
the existing account may have been created with an empty bootstrap password.

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
container applies migrations, runs the bootstrap seed (no demo data), then
starts the server. PostgreSQL is published on `127.0.0.1:5432` only. From
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
is required until the admin account exists (remove it afterwards), CORS is
disabled unless `CORS_ORIGIN` is set (`CORS_ALLOW_ANY=true` is refused), and
the API docs are off unless `API_DOCS_ENABLED=true`. After the first start,
`npm run db:check-bootstrap` confirms the database holds no business data
before the opening-balance import.

## Dropping the Rack table

Migration `20260101000022_drop_racks` drops the old Rack table (racks are
locations of type Rack now). It cannot be undone, so it refuses to run while
any Rack row remains. On each database:

1. **Back it up** before deploying this release, e.g. with Docker:
   `docker exec afrinov-dev-pg pg_dump -U afrinov -d afrinov -f /tmp/backup.sql`
   then `docker cp afrinov-dev-pg:/tmp/backup.sql ./import-reports/backup.sql`.
2. **Check it has no racks left:** `SELECT count(*) FROM racks;` should be 0.
   If it is not, copy them onto locations first, with the release before this
   one, which still has the command (this release removes it with the table):

   ```sh
   git switch --detach e7ad3b5      # main before the Rack table was dropped
   npm run racks:to-locations       # dry run: read the report in import-reports/
   npm run racks:to-locations -- --create <code> --discard <code> --apply --database <name> --actor <email>
   git switch main                  # back to this release
   ```

   Repeat the dry run until it reports 0 racks.
3. **If the migration already refused** (its error says "The racks table
   still has N row(s)"), Prisma recorded it as failed and every later deploy
   stops with `P3009` (in Docker, the API does not start). After step 2, clear
   that record, then deploy again:

   ```sh
   npx prisma migrate resolve --rolled-back 20260101000022_drop_racks
   npm run db:migrate
   ```

   Nothing was dropped when it refused: the migration checks and drops in one
   locked step, so a refusal leaves the database as it was.

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
| `CORS_ALLOW_ANY` | No | — | `true` allows any origin. Throwaway demos only; refused in production |
| `RATE_LIMIT_AUTH` | No | `5` | Login requests per minute per IP |
| `RATE_LIMIT_GLOBAL` | No | `1000` | All other requests per minute per IP |
| `TRUST_PROXY` | Behind a proxy | Trust none | Which proxies may report the client address: a hop count (usually `1`), a comma-separated list of addresses or CIDR ranges, or `true`. Without it, behind a load balancer every user shares one rate-limit budget and the sign-in audit records the proxy's address |
| `DB_STATEMENT_TIMEOUT_MS` | No | `30000` | Longest one SQL statement may run before PostgreSQL cancels it. `0` switches it off (e.g. for a large one-off import) |
| `PROCUREMENT_ENABLED` | No | `true` | `false` turns off purchase orders and goods receipts. Keep in step with the frontend's `VITE_PROCUREMENT_ENABLED` |
| `API_DOCS_ENABLED` | No | On, except in production | `true` or `false` to serve the API docs at `/api/docs` |
| `SEED_ADMIN_PASSWORD` | Until the admin exists, in production | Random in development | Password for the bootstrap account when it is created (it must be changed at first sign-in), or for an explicit rotation |
| `SEED_DEMO_DATA` | No | — | `true` makes the seed load demo data, like `--demo`. Refused in production |
| `SEED_ADMIN_EMAIL` | No | `admin@afrinov.local` | Account used by the integration tests and diagnostic scripts |
| `REPORT_CURRENCY` | No | `ZAR` | Currency code returned with the inventory report (`/reports/inventory`) only; the other reports use the `general.defaultCurrency` setting |

## Scripts

Run from `apps/backend`.

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the API with hot reload, reading `.env` |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled API |
| `npm run db:generate` | Generate Prisma Client from `prisma/schema.prisma` |
| `npm run typecheck` | Generate Prisma Client and type-check `src/`, `integration/` and `scripts/` without emitting files |
| `npm run lint` | Run ESLint on `src/`, `integration/` and `scripts/` |
| `npm test` | Run the unit tests |
| `npm run test:integration` | Run the integration tests against a real database |
| `npm run db:migrate` | Apply pending Prisma migrations |
| `npm run db:seed` | Write the bootstrap: permissions, roles, the admin account and the settings catalog. No business data |
| `npm run db:seed:demo` | The bootstrap plus demo suppliers, materials, projects, orders and stock movements. Development and test only |
| `npm run db:check-bootstrap` | Read-only: fails if the database holds any business data or has no administrator. Run on a new production database before the opening-balance import |
| `npm run import:workbook -- --file <workbook.xlsm>` | Dry run of the stock workbook import: checks the four Main and four Summary sheets against the mapping file and writes a problem report to `import-reports/` (git-ignored). The first run creates `import-reports/mapping.xlsx` (new SKUs, units, locations) and `import-reports/master-data.xlsx` (projects, recipients, suppliers) for the storeman and buyer to review; later runs read them. Never touches the database |
| `npm run import:workbook -- --file <workbook.xlsm> --apply --database <name> --date <YYYY-MM-DD> --actor <email>` | The real import, once per database: creates the projects, recipients and suppliers (skipping any that exist), the items and locations and posts one dated opening-balance receipt per item and location, all or nothing. Refuses while the dry run has blocking problems, when `--database` does not match `DATABASE_URL`, or when opening balances were imported before |
| `npm run import:suppliers -- --file <Item Description workbook.xlsm>` | Dry run of the vendor list import: reads the "Suppliers" sheet of the AFRI-0000_x purchase order template, compares it with the suppliers in `DATABASE_URL` (by name, ignoring case) and writes a report to `import-reports/` of new suppliers, existing ones whose empty fields would be filled, and rows to review (duplicate names, vendor codes already taken, invalid emails, unknown currencies). Never touches the database |
| `npm run import:suppliers -- --file <workbook.xlsm> --apply --database <name> --actor <email>` | The real vendor list import, in one transaction: creates the new suppliers and fills only empty fields on existing ones, so it never overwrites what was typed in the app and can be run again. Refuses when `--database` does not match `DATABASE_URL` |
| `npm run import:workbook -- --file <workbook.xlsm> --reconcile` | After the import: compares the database in `DATABASE_URL` with the workbook plan (item count, units and rand value per category, and every item that differs) and writes a reconciliation report to `import-reports/`. Read-only |
| `npm run diag:login` | Log in as the seed admin through the full server and print the result. Needs `.env` with `SEED_ADMIN_PASSWORD` |
| `npm run diag:admin` | Print whether the seed admin exists, is active, its roles, and every user's email and status. Needs `.env` |

The two `diag:` scripts live in `scripts/`, outside the build, and refuse to
run when `NODE_ENV=production`.

## Tests

- **Unit tests** (`src/**/*.test.ts`) mock the database and need no setup:
  `npm test`.
- **Integration tests** (`integration/`) start the real server and talk to a
  local disposable PostgreSQL database. The integration configuration reads
  `.env.test` only and refuses remote hosts or database names without the
  `_test` suffix. It never falls back to `.env`.

  From `apps/backend`, prepare the separate Compose test service. Set
  `POSTGRES_TEST_PASSWORD` in the shell to a dedicated disposable value (if
  omitted, Compose falls back to the required local `POSTGRES_PASSWORD`), copy
  `.env.test.example` to `.env.test`, and make its URL password match. Then run:

  ```sh
  docker compose --profile test up -d test-db
  npm run db:test:migrate
  npm run db:test:seed
  npm run test:integration
  ```

  `db:test:migrate` and `db:test:seed` use the same local-host and `_test`
  database guard. Seeding requires `SEED_ADMIN_PASSWORD` in the ignored
  `.env.test` or shell environment. Integration tests create persistent rows;
  this dedicated test database is their only supported target.

- **Browser E2E** (`../frontend/e2e/`) uses the same `.env.test` database and
  seeded admin. It injects the password from `SEED_ADMIN_PASSWORD`, sends no
  login body to logs, runs the API in `NODE_ENV=test`, and uses an explicit
  local CORS origin. From `apps/frontend`, run `npm exec playwright test` after
  the test DB setup above.

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
    identity/          Login, users and roles
    inventory/         Materials, locations (racks inside their rooms), stock items, stock movements and counts, tool loans, balances
    procurement/       Suppliers, purchase orders, goods receipts
    operations/        Projects and recipients ("Issued To")
    migration/         Reading and checking the stock workbook; opening-balance import; reconciliation
    reporting/         Stock, movement, stock-status, stock-value, consumption, month-end and
                       inventory reports; Excel/PDF export
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
(`/health`, `/health/ready`). Everything except login and the health checks
needs an `Authorization: Bearer <token>` header, using the token returned by
`POST /api/v1/auth/login`.

| Area | Endpoints |
| --- | --- |
| Auth | `/auth/login`, `/auth/me` |
| Users | `/users`, `/users/lookup` |
| Inventory | `/materials`, `/locations`, `/stock-items`, `/inventory-transactions` (with `/:id/returns` and `/:id/reversal`), `/inventory-issues`, `/inventory-transfers`, `/inventory-adjustments`, `/stock-counts`, `/stock-receipts` |
| Procurement | `/suppliers`; `/purchase-orders` and `/goods-receipts` unless `PROCUREMENT_ENABLED=false` |
| Projects and recipients | `/projects`, `/recipients` |
| Reports | `/reports/current-stock`, `/reports/movement-history`, `/reports/stock-status`, `/reports/stock-value`, `/reports/low-stock`, `/reports/reorder-list/export`, `/reports/project-consumption/:projectNumber`, `/reports/consumption` (+ `/export`), `/reports/month-end` (+ `/export`), `/reports/inventory` (+ `/export`) |
| Settings | `/settings` |
| Audit | `/audit` |
| Health | `/health` (process is up), `/health/ready` (database is reachable) |

Errors use one shape: `{ "error": { "code", "message", "details" } }`.

Permissions are checked on the server. The roles are `ADMIN`,
`STORE_CONTROLLER`, `PROCUREMENT`, `APPROVER`, `TECHNICIAN` and `VIEWER`;
`src/shared/permissions.ts` maps each role to what it may do.

There is no self-registration: an administrator creates accounts and
assigns roles under Settings → Users (`POST /users`; ADR-006).
