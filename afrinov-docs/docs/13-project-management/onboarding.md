# Developer Onboarding

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

How to get the platform running on your machine, check a change, and deploy
it. For what the system is and why, start with `../README.md`; for the
architecture, `../06-system-architecture/architecture-overview.md`.

Commands use Git Bash / macOS / Linux syntax. In PowerShell, set a variable
for one command with `$env:NAME = "value"; <command>`.

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 22 or later (24 recommended) | Vitest 5 and the frontend test tools do not start on Node 20 |
| npm | Comes with Node (workspaces needed) | Dependencies are installed once, at the workspace root |
| Docker with Compose | Any recent | Local PostgreSQL 16, and the backend container |
| Git | Any | — |

## 2. Repository layout (what you will touch)

```
afrinov-platform/              npm workspaces root — run npm install and most scripts here
├── apps/backend/              Fastify API, Prisma schema + migrations, scripts/, integration/
└── apps/frontend/             React SPA (Vite), e2e/ (Playwright)
afrinov-docs/docs/             documentation (this tree)
.github/workflows/             CI: backend-ci.yml, frontend-ci.yml
```

## 3. First-time setup

1. **Install dependencies** from the workspace root:
   ```sh
   cd afrinov-platform
   npm install
   ```
2. **Create the backend environment file** and a JWT secret:
   ```sh
   cd apps/backend
   cp .env.example .env
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```
   Paste the printed value into `JWT_SECRET` in `.env`. Never commit `.env`
   (it is git-ignored). Every variable is described in `.env.example` and in
   `apps/backend/README.md`.
3. **Start PostgreSQL** (still in `apps/backend`). The password must match
   the one in `DATABASE_URL` in your `.env`:
   ```sh
   POSTGRES_PASSWORD=afrinov docker compose up -d db
   ```
4. **Create the database schema and demo data:**
   ```sh
   npx prisma generate
   npm run db:migrate
   SEED_ADMIN_PASSWORD=<choose-a-password> npm run db:seed
   ```
   The seed creates `admin@afrinov.local` with that password, plus roles,
   permissions, settings and demo stock. It is safe to re-run, but it sets
   the admin password **only when it first creates the account**; without
   `SEED_ADMIN_PASSWORD` it generates a random password and does not print
   it.
5. **Frontend environment (optional).** The frontend runs without a `.env`.
   Copy `apps/frontend/.env.example` to `.env` only to change a flag (see
   section 5).

## 4. Run and start

From `afrinov-platform/`, in two terminals:

```sh
npm run dev:backend    # API with hot reload on http://localhost:4000
npm run dev:frontend   # app on http://localhost:5173
```

- Sign in at <http://localhost:5173> as `admin@afrinov.local` with your seed
  password.
- The Vite dev server proxies `/api` to `http://localhost:4000`, so the
  browser never needs CORS settings in development.
- API docs (Swagger UI): <http://localhost:4000/api/docs>.
- Health: <http://localhost:4000/health> (process up) and
  <http://localhost:4000/health/ready> (`"database": "connected"` when
  PostgreSQL is reachable).

**Without a backend.** To look at the UI on mock data only, from
`apps/frontend`: `npm run dev:frontend-only` (see
`afrinov-platform/apps/frontend/FRONTEND_ONLY.md`).

## 5. Feature flags you will meet

| Flag | Where | Effect |
|---|---|---|
| `PROCUREMENT_ENABLED` | backend `.env` | `"true"` registers the purchase-order and goods-receipt API routes |
| `VITE_PROCUREMENT_ENABLED` | frontend `.env` | `"true"` shows the purchase-order and goods-receipt pages. Keep it in step with the backend flag |
| `VITE_FRONTEND_ONLY` | frontend | `"true"` swaps the API for in-memory mock data |
| `VITE_DEMO_AUTH_ENABLED` | frontend | `"true"` accepts one demo login pair. A production build refuses to run with this or `VITE_FRONTEND_ONLY` on |
| `API_DOCS_ENABLED` | backend | Forces `/api/docs` on or off (on by default outside production) |

Restart the dev server after changing a `VITE_*` flag; Vite reads them at
start-up.

## 6. Check a change: lint, typecheck, test, build

From `afrinov-platform/` these run for both apps:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Or per app, from `apps/backend` or `apps/frontend`, with the same script
names.

| Command | Backend | Frontend |
|---|---|---|
| `npm run lint` | ESLint on `src/`, `integration/`, `scripts/` | ESLint on `src/` |
| `npm run typecheck` | `tsc` over `src/`, `integration/`, `scripts/` (no output) | `tsc -b --noEmit` |
| `npm test` | Vitest unit tests; the database is replaced by fakes, no setup needed | Vitest + jsdom component and unit tests |
| `npm run build` | Compiles to `apps/backend/dist/` | Type-checks, then builds `apps/frontend/dist/` |

Use `npm run test:watch` in `apps/backend` (or `npx vitest` in
`apps/frontend`) while working.

### Backend integration tests (real database)
These start the real server and talk to PostgreSQL. They **write data**,
and by default they use the `DATABASE_URL` in your `.env` — your
development database. To keep them apart, use a second database:

```sh
cd apps/backend
POSTGRES_PASSWORD=afrinov docker compose exec db createdb -U afrinov afrinov_test
export DATABASE_URL="postgresql://afrinov:afrinov@localhost:5432/afrinov_test?schema=public"
npx prisma migrate deploy
SEED_ADMIN_PASSWORD=<password> npm run db:seed
SEED_ADMIN_PASSWORD=<same password> npm run test:integration
```

A `DATABASE_URL` set in the shell wins over the one in `.env`. The tests
sign in as the seeded admin, so `SEED_ADMIN_PASSWORD` must be the password
the seed used for that database.

### End-to-end test (Playwright)
One test (`apps/frontend/e2e/login.spec.ts`) signs in through the real
stack. Its global setup starts the backend on port 4000 and the frontend on
port 5173 itself, so **stop your dev servers first**. It uses the backend
`.env` database, and it expects the admin password written in the spec
file to be the one the seed used (TD-017).

```sh
cd apps/frontend
npx playwright install chromium   # first time only
npx playwright test
```

### What CI runs
On every pull request that touches an app (and on pushes to `main`):
backend — typecheck, lint, unit tests, build, and the integration tests
against a throwaway PostgreSQL; frontend — typecheck, lint, tests and a
production build. Playwright is not run in CI. Details:
`../12-operations/ci-cd.md`.

### Database changes
Edit `apps/backend/prisma/schema.prisma`, then create a migration with
`npx prisma migrate dev --name <what-changed>` against your development
database, and commit the new folder under `prisma/migrations/`. Migrations
only go forward; there are no down migrations. History:
`../07-data/migration-strategy.md`.

## 7. Deploy

**What exists:** a backend container and a compose file. **What does not:**
a deployment pipeline, a staging environment, or a chosen hosting target —
these are open (assumption A-11, `../12-operations/deployment.md`).

### Backend and database
From `apps/backend` on the target machine:

```sh
POSTGRES_PASSWORD=<db password> \
JWT_SECRET=<generated secret> \
SEED_ADMIN_PASSWORD=<first admin password> \
CORS_ORIGIN=<https://the-site-origin> \
docker compose up --build -d
```

On every start the container runs `prisma migrate deploy`, then the seed
(idempotent), then the API on port 4000. It runs with
`NODE_ENV=production`, which means:
- the server refuses to start without a real `JWT_SECRET` (the example
  placeholder is rejected);
- `SEED_ADMIN_PASSWORD` is required the first time, against an empty
  database;
- CORS is off unless `CORS_ORIGIN` is set; API docs are off unless
  `API_DOCS_ENABLED=true`;
- set `PROCUREMENT_ENABLED=true` here if purchase orders are wanted.

Check it with `GET /health/ready`. To deploy a new version, pull the code
and run the same `docker compose up --build -d`; pending migrations apply
on start. Rolling back across a migration needs a manual plan.

### Frontend
Build the static files with the production flags you need, for example:

```sh
cd afrinov-platform
VITE_PROCUREMENT_ENABLED=false npm run build --workspace=@afrinov/frontend
```

Serve `apps/frontend/dist/` from a web server that:
- sends `index.html` for unknown paths (the app uses client-side routes
  such as `/stock/issue`);
- forwards `/api/` to the backend on port 4000 — the app calls the API at
  the relative path `/api/v1`, so it must be reached on the same origin.

### Go-live data
The workbook's opening balances are loaded once with
`npm run import:workbook` (dry run, review files, `--apply`,
`--reconcile`). Follow `../07-data/migration-strategy.md`.

### Backups
None are configured; the compose stack keeps data in the Docker volume
`afrinov_pg`. Arrange database backups before real data goes in
(`../12-operations/backup-and-recovery.md`).

## 8. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Tests fail to start, or odd errors from Vitest | Node older than 22. Check `node -v` |
| Can't sign in after seeding | The seed ran without `SEED_ADMIN_PASSWORD` (random password), or the account already existed so the new password was ignored. `npm run diag:admin` shows whether the admin exists and is active; in development you can start over with `docker compose down -v` (**deletes all local data**) |
| `Configuration error: JWT_SECRET …` at start-up | `JWT_SECRET` missing, or a placeholder value while `NODE_ENV` is production or unset |
| `/health/ready` returns 503 | PostgreSQL not running or `DATABASE_URL` wrong; `docker compose ps` |
| `429 TOO_MANY_REQUESTS` on login | Over 5 login attempts per minute from your IP; wait a minute or raise `RATE_LIMIT_AUTH` locally |
| Purchase-order pages or routes missing | Set both `PROCUREMENT_ENABLED` and `VITE_PROCUREMENT_ENABLED` to `"true"` and restart |
| `npm run build` (frontend) refuses to run | `VITE_FRONTEND_ONLY` or `VITE_DEMO_AUTH_ENABLED` is `true` in the shell or a `.env` file |
| Playwright fails to start servers | Ports 4000/5173 are in use by your dev servers |

## Evidence
- `afrinov-platform/package.json:10-19` — root scripts
- `afrinov-platform/apps/backend/package.json:7-21`, `afrinov-platform/apps/frontend/package.json` — app scripts
- `afrinov-platform/apps/backend/README.md` — local setup and environment variables
- `afrinov-platform/apps/backend/docker-compose.yml`, `afrinov-platform/apps/backend/Dockerfile`
- `afrinov-platform/apps/backend/vitest.integration.config.ts` — loads `.env` without overriding shell variables
- `afrinov-platform/apps/backend/integration/helpers.ts:13-19` — admin login for integration tests
- `afrinov-platform/apps/frontend/e2e/global-setup.ts` — E2E starts both servers
- `afrinov-platform/apps/frontend/vite.config.ts:6-24` — build guard and dev proxy
- `afrinov-platform/apps/frontend/src/api/client.ts:61` — relative `/api/v1` calls
- `afrinov-platform/apps/backend/src/shared/config.ts:42-98` — production checks, flags
- `afrinov-platform/apps/backend/src/server.ts:114-138` — login rate limit
- `.github/workflows/backend-ci.yml`, `.github/workflows/frontend-ci.yml`
