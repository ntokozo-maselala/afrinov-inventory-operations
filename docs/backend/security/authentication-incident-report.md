# Authentication incident investigation

**Status: open; primary production root cause unresolved.** The current source
explains the 404 and enumerates the exact branches that can produce the 401,
but the deployed artifact, request source, production logs, and authoritative
account/database evidence were unavailable. No change to login lookup,
password verification, or external login responses was made. Independent test
isolation and JWT algorithm controls are documented below.

## Executive summary and timeline

The supplied incident evidence has no calendar date or timezone:

| Time | Event | What the evidence establishes |
| --- | --- | --- |
| 10:14:27 | `GET /api/v1/auth/login` returned 404, `Route GET:/api/v1/auth/login not found` | The reported process had no matching GET route. Current checkout intentionally exposes login as POST-only. The caller is unknown. |
| 10:18:47-10:18:48 | `POST /api/v1/auth/login` returned 401 `UNAUTHENTICATED` / `Invalid credentials`, request ID `req-2m`, about 643 ms | The request reached an authentication rejection in the reported process. In current source, three credential/account branches produce this response. The specific branch is not in the supplied evidence. |

The impact, number of affected users, successful-login rate, deployed version,
and whether both requests reached the same process are unknown. The events are
about four minutes apart, but that alone does not establish a shared cause.

## Phase A record made before application changes

The initial evidence and investigation plan were recorded here before source
changes. The inspected workspace is `afrinov-inventory-operations`, branch
`main`, initial commit `731e238`; the runnable npm workspace is
`afrinov-platform/`. The initial tree was clean. Backend documentation is
maintained under `docs/backend/`; no `AGENTS.md` was found.

The local ignored backend `.env` was present. Only non-secret identity was
inspected: development mode, local PostgreSQL on port 5432, database `afrinov`,
schema `public`. Its credentials and JWT secret were not read or recorded.
There was no service listener on ports 4000, 5173, or 5432. Docker CLI was
present, but Docker engine/config access was denied. This local configuration
does not establish which database or environment served the incident.

The application is TypeScript/Node.js with Fastify 5, React/Vite, PostgreSQL,
and Prisma 5. On this workstation Node is 24.21.0 and npm is 11.19.0. The
installed versions observed include Fastify 5.12.7, `@fastify/jwt` 10.2.2,
Prisma/client 5.22.0, and bcryptjs 2.4.3. Current auth source has local
email/password login and HMAC JWTs. No current `authMode`, JWKS client,
external identity provider, issuer/audience configuration, refresh-token
flow, or asymmetric-key rotation was found. A previous note that said
`authMode=jwks` has no matching setting in this checkout; it may refer to
another artifact or revision.

### Request execution map

`HTTP POST /api/v1/auth/login`
-> `apps/backend/src/index.ts` loads runtime config and calls `start()`
-> `apps/backend/src/server.ts` builds Fastify, registers CORS, Helmet, JWT,
   rate limiting, request IDs, error handling, and feature modules
-> modules mount once under `/api/v1`; auth routes are registered without an
   auth-mode feature flag
-> `POST /auth/login` in `apps/backend/src/modules/identity/auth.routes.ts`
   validates email and nonempty password with Zod
-> `AuthService.login()` in
   `apps/backend/src/modules/identity/identity.service.ts` lowercases email,
   queries Prisma `user.findUnique`, checks `active`, and calls
   `bcrypt.compare()` on the stored password hash
-> success signs `{sub,email,name,roles}` as an HS256 JWT with 12-hour expiry
   and returns `{token,user}`; protected requests verify the bearer token and
   then check the account's current active state in PostgreSQL
-> the central error handler returns a generic API error body.

The current login response `UNAUTHENTICATED` / `Invalid credentials` is
generated for (1) no matching account, (2) an inactive account, or (3) bcrypt
password mismatch. The service does not catch database or bcrypt exceptions
and turn them into that 401; those unexpected failures reach the generic 500
handler. The external message is intentionally the same for the three
credential/account branches. Current logs include the request ID and generic
API error code/message, but do not identify which of those branches ran.

Frontend map: `apps/frontend/src/pages/Login.tsx` prevents the browser's
default form submission and calls `useAuth().login()`; `apps/frontend/src/auth.tsx`
calls `apps/frontend/src/api/authService.ts`; that calls
`api.post('/auth/login', ...)` in `apps/frontend/src/api/client.ts`, which
requests `/api/v1/auth/login`. In development, `apps/frontend/vite.config.ts`
proxies `/api` to `http://localhost:4000`. The SPA route is `/login`; its
source does not submit a GET to the API login path. The source caller of the
reported GET remains unknown.

The frontend separately has mock/demo switches: `VITE_FRONTEND_ONLY` routes
the API client to an in-memory mock, and `VITE_DEMO_AUTH_ENABLED` enables
build-time demo credential matching. These are frontend presentation modes,
not backend identity-provider modes. `src/config/buildGuard.ts` refuses a
production Vite build when either is enabled. The revised E2E setup explicitly
sets both false. The reported POST reached backend authentication logic, but
that does not identify which browser/client produced it.

On successful live login, `AuthService.login()` returns a token and user
summary; `authService.ts` stores the token as `afrinov.token` in
`localStorage`, while `auth.tsx` stores the user summary in `sessionStorage`.
The frontend calls `/auth/me` on restore. Logout clears browser storage only;
there is no backend logout endpoint or token revocation store.

`prisma/schema.prisma` defines a unique user email, `password_hash`, an active
flag, and relations to roles. Seed and account-write paths lowercase email.
There are 23 migration directories; applied migration state for the incident
database is unknown. No query was run against the developer DB or an incident
DB. `shared/config.ts` requires `DATABASE_URL` and `JWT_SECRET`; unset
`NODE_ENV` defaults to `production`, but it is cast rather than validated
against an enum. Local `dev` loads `.env` using Node's `--env-file`; compiled
`start` relies on injected process environment; the incident process settings
were not supplied.

Configuration differs by execution path: the backend `dev` script loads
`apps/backend/.env`; compiled `npm start` expects injected process variables;
CI supplies explicit variables; Compose interpolates the invoking
environment. The integration/E2E changes in this task use only
`apps/backend/.env.test` plus existing shell variables and reject non-local or
non-`_test` database URLs. Actual Windows PowerShell, WSL, CI, container, and
deployment configurations cannot be inferred from this checkout.

| Environment | Evidence available | Limit |
| --- | --- | --- |
| Windows PowerShell workstation | Node 24.21.0/npm 11.19.0; local `.env` points to `localhost:5432/afrinov`; no DB listener was present. | No DB writes were made. This is not incident environment provenance. |
| WSL | None supplied or used. | Distribution, environment variables, and database state are unknown. |
| Docker Compose | Synthetic-value config parsing passes; normal profile works without test-only variables; test profile resolves to loopback port 5433 and a separate volume. | Docker engine/config access was denied; no container or DB started. |
| CI | Workflow source selects Node 24 and an ephemeral Postgres 16 service. | No GitHub Actions run, branch protection, or artifact was accessible. |
| Deployment | No image digest, runtime logs, effective settings, DB identity, or account state supplied. | Production behavior cannot be verified from this checkout. |

## Hypothesis register

| Hypothesis | Evidence for | Evidence against | Verification | Result | Root-cause status | Corrective action |
| --- | --- | --- | --- | --- | --- | --- |
| The GET came from the SPA login form or its API client. | A login page exists. | The form prevents native submission and the API client calls `post`; source has no GET login call. | Trace `Login.tsx`, `auth.tsx`, `authService.ts`, `client.ts`; E2E captures method and path. | Disproven for the current frontend source; incident caller evidence is absent. | Unresolved caller; separate from POST 401. | Keep POST-only. Regression asserts frontend request is POST. Obtain browser network initiator or client/monitoring config to identify the actual GET caller. |
| The GET is expected for a POST-only route. | `auth.routes.ts` registers POST login and GET `/auth/me`, not GET login; route test asserts unsupported GET returns 404. | The caller may still contain a client, redirect, API-prefix, or stale-artifact defect. | Inspect route registration and inject GET `/api/v1/auth/login`; inspect browser/client evidence for caller. | Confirmed contract in this checkout; incident intent and caller remain unknown. | Expected route response in this source; not a cause of POST 401. | Do not add a GET login handler. Confirm whether the reported caller should issue GET. |
| The user entered the wrong password. | Password mismatch is one branch that returns the exact 401. | Missing account and inactive account return the same response; no incident request body or account state was supplied. | Use approved identity tooling to verify the normalized account/status, then controlled credential validation against the authoritative source. Never export a hash. | Unresolved. | Potential primary cause, not established. | No password reset or login behavior change without identity evidence. |
| The account was missing or inactive in the database used by the failing process. | Both conditions return the exact 401; lookup is by lowercased email. | No authoritative incident database, account state, environment identity, or deployment revision is available. | Establish deployment DB host/name/schema and migration state; use controlled admin lookup returning only found/active status for a stable redacted account ID. | Unresolved. | Potential primary cause, not established. | Correct account provisioning/status only after environment and account ownership are proven. |
| A password-hash incompatibility or stale seed caused the rejection. | Local auth uses bcryptjs and seeded identities are environment-specific. | No incident hash algorithm/format or seed history was supplied. `bcrypt.compare()` supports the application's expected bcrypt hashes; no evidence links seed state to this event. | In an isolated fixture DB, verify known test credentials and supported existing hash formats; inspect authoritative seed/migration provenance without exporting a hash. | Unresolved for incident; no incompatibility demonstrated in current source. | Potential contributing factor only if external evidence confirms. | Do not reseed or rotate production accounts speculatively. |
| A JWKS/local-auth mode mismatch caused the 401. | Prior environment investigation mentioned `authMode=jwks`. | Current checkout has no `authMode` or JWKS implementation; POST login is local DB/password auth. A 401 was emitted from the auth path, but deployed source is unknown. | Compare deployed image digest/commit and effective non-secret auth settings with this checkout. | Current source has no JWKS mode; production compatibility unresolved. | Unrelated in this checkout; incident status unknown. | Do not add an implicit local/JWKS fallback. Define an explicit mode only if the deployed architecture proves it is required. |
| Wrong API prefix or unregistered login route caused the POST 401. | Both could produce route failures in some deployments. | Current server applies `/api/v1` once and registers POST login; reported POST reached the authentication rejection code, not a route 404. | Inspect current module registration and exact route tests; compare deployed artifact if available. | Disproven for this checkout's POST 401. | Not a root cause in current source. | Keep prefix registration deterministic; route contract tests cover POST and unsupported GET. |
| A database or crypto infrastructure error was converted into invalid credentials. | The reported external message is generic. | Current service does not catch Prisma/bcrypt exceptions as credential errors; central handler turns unexpected exceptions into generic 500s. | Inspect `AuthService.login()` and central error handler; controlled mock failures can distinguish error class. | Disproven for current source. Production implementation remains unverified. | Not a root cause in current source. | Preserve 500 separation; compare deployed source/logs before concluding for production. |
| Tests or environment selection can use the developer database and create cross-machine failures. | Before this change integration config loaded `.env`, forced development mode, and E2E also loaded `.env`; local `.env` names `afrinov`, and tests persist rows. | This is a test/reproducibility hazard, not evidence about the incident runtime. | Static inspection; new test URL guard unit coverage; Playwright discovery with synthetic `_test` URL. | Confirmed repository hazard; preventive changes made. A missing-test-URL migration attempt did not reach the guard because `tsx` failed first with OS `ENOMEM`. | Contributing reliability risk, unrelated to incident root cause. | `.env.test` only, local `_test` URL guard, separate Compose test service/volume, injected E2E secrets, Node 24 CI, and guarded test DB scripts. |
| JWT algorithm acceptance was implicit and broader than the app's signing choice. | Previously signing defaulted to HS256 while `fast-jwt` verifier accepted multiple HMAC algorithms for a string key. | Incident POST 401 occurs before token signing, so this cannot explain it. | Installed dependency source/docs review and HS384/expired/tampered-token route regressions. | Confirmed independent security defect; explicit HS256 sign/verify now present. | Unrelated security finding, not an incident root cause. | Pin HS256 for signing and verification; maintain rejection tests. |

## Authentication architecture and security findings

The checkout's intended model is local email/password authentication owned by
the PostgreSQL `users` table. The backend lowercases email for lookup, stores
new password hashes with bcrypt cost 12, issues HS256 JWT bearer tokens with a
12-hour expiry, and checks current account active status on protected
requests. Rate limiting applies a stricter budget to the login path. There is
no refresh, server-side token revocation list, issuer/audience validation,
JWKS retrieval/caching, key ID/rotation, or external identity provider in the
current implementation. This describes the inspected checkout, not the
reported deployment.

The JWT verifier is now explicitly limited to HS256, matching the app's
issuer. Tests reject HS384, expired, and tampered tokens. Login lookup,
password comparison, response contract, and role authorization were not
changed. The tests do not establish issuer/audience policy or external JWKS
behavior because this checkout has no such implementation.

The generic 401 prevents the client from distinguishing unknown, inactive,
and password-mismatch cases, but current internal logs also do not preserve a
sanitized branch category. The request ID could correlate the generic error;
it cannot recover the branch after the fact. Database and crypto exceptions
remain distinct generic 500s in current code. No password, hash, token, or
secret was added to logs or this report.

## Cross-environment changes and compatibility

- Integration Vitest setup now reads `.env.test` only, sets `NODE_ENV=test`,
  uses a process-random JWT key, and validates a direct local PostgreSQL URL
  without host overrides whose database name ends in `_test`.
- Added guarded `db:test:migrate` and `db:test:seed`; both validate the test
  URL before spawning a write command. Test seeding requires an injected
  `SEED_ADMIN_PASSWORD`.
- Added a separate Compose `test-db` profile on loopback port 5433 with its
  own named volume. The ordinary development DB stays separate. A distinct
  `POSTGRES_TEST_PASSWORD` is preferred; Compose falls back to the required
  local `POSTGRES_PASSWORD` so the inactive profile does not break normal
  Compose commands.
- Playwright now uses the same isolated DB guard, injected test seed
  password, test-only runtime, explicit localhost CORS origin, and disables
  demo auth. Its login E2E checks the POST method/path and no longer contains
  a literal password.
- `.env.test` is ignored; its template contains non-secret examples only.
- Backend CI and Docker base image now use Node 24, consistent with Vitest 5.
  The Dockerfile installs from the workspace lockfile and copies backend
  sources and Prisma schema before build. The root `.dockerignore` keeps
  ignored local environment files out of the build context. Startup logs the
  single supported mode as `local-password` without logging secrets.
- Backend/frontend docs and configuration reference were updated. Existing
  auth route, JWT and test-environment regressions cover the confirmed source
  contracts.

Compatibility: the public login contract remains `POST /api/v1/auth/login`
with the same success and credential-failure response shapes. The JWT
algorithm restriction accepts application-issued HS256 tokens. Operators
should confirm deployed tokens are HS256 before rollout; tokens using other
algorithms will now fail verification. Test users must migrate from old
`.env`-based integration setup to a local `.env.test` database with `_test`
suffix. No production database migration or account update was made.

## Verification record

Executed on 2026-10-23, Node 24.21.0 and npm 11.19.0 unless noted:

| Check | Result | Limits |
| --- | --- | --- |
| Backend unit suite: `$env:LOG_LEVEL='silent'; npx.cmd vitest run --silent --reporter=dot` | Passed: 57 files, 813 tests. | No live DB. The command required execution outside the sandbox after esbuild was denied access to the workspace parent. |
| Backend lint: `npm.cmd run lint` | Passed. | Static check only. |
| Backend TypeScript: `npx.cmd tsc -p tsconfig.tools.json --noEmit` and `npx.cmd tsc -p tsconfig.build.json --noEmit` | Both passed. | Used the existing generated Prisma client; no DB connection. |
| Package typecheck/full backend build with Prisma generation | Later attempts failed with Windows `EPERM` renaming the locked `query_engine-windows.dll.node`. | Current-source TypeScript checks passed above; package lifecycle commands that regenerate Prisma were not reverified after the file lock appeared. |
| Focused auth route suite | Passed: 1 file, 15 tests. | Includes method contract and token rejection regression. |
| Focused test-database URL guard suite | Passed: 1 file, 6 tests. | Covers local URL acceptance and remote/production-like/host-override rejection without echoing connection strings. |
| Frontend unit suite: `npx.cmd vitest run --silent --reporter=dot` | Passed: 76 files, 799 tests. | E2E specs are not run by Vitest. |
| Frontend lint and type check | Passed. | Includes E2E and Playwright config sources. |
| Frontend production build: `npm.cmd run build` | Passed. | Vite reported config-loader/esbuild deprecations, a direct-eval warning in ExcelJS, and a chunk above 500 kB. |
| Playwright discovery: `npx.cmd playwright test --list` with a synthetic local `_test` URL and fixture password | Passed: found 2 E2E tests. | Discovery only; did not launch servers, browser, or DB. |
| Compose config with and without `--profile test` using synthetic variables | Both parsed; normal Compose works without `POSTGRES_TEST_PASSWORD`, and the test profile binds loopback port 5433 with the workspace-root build context. | Docker config access warned; no engine/image startup. |
| Prisma schema validation | Passed: `prisma validate`. | Does not establish applied migration state. |
| `npm ci` from workspace root | Failed twice on Windows `EPERM` unlink of locked native Rolldown/Rollup files. | No lockfile change. Recovery `npm.cmd install --no-audit --no-fund` exited 0 with cleanup warnings; this is not a clean-install pass. |
| `npm audit --audit-level=moderate` | Exit 1: 7 dependency findings (2 moderate, 5 high), involving transitive `braces` and `postcss-selector-parser` paths. | npm proposed a forced Tailwind CSS major upgrade; not applied because it is breaking and unrelated to auth. |
| Guarded migration command with no `.env.test` | Did not reach the guard: `tsx` failed in Node `os.userInfo()` with `uv_os_get_passwd` / `ENOMEM`. | No DB connection or write occurred. The guard's validation cases are covered by unit tests. |

The real PostgreSQL integration suite and full Playwright login flow were not
run because there was no isolated database service available and Docker
engine access was denied. No migration, seed, password rotation, or database
write was executed. The local ignored `afrinov` DB was not used. Docker image
build/startup and a GitHub Actions run remain unverified. The actual process
that served the incident, its account data, applied migration state, and
production configuration are not available here.

## Evidence required to close the incident

1. Sanitized backend logs for both timestamps and the complete `req-2m`
   correlation, including process/image revision and any structured auth
   outcome category. Do not provide passwords, tokens, hashes, or secret
   environment values. Current source logs do not distinguish the three
   credential branches.
2. Deployed artifact digest/commit and effective non-secret settings for
   environment, API prefix, auth mode, database host/name/schema, and frontend
   API origin. Secrets should be represented only as present/absent or by
   approved secret version IDs.
3. Authoritative database migration state and a controlled identity lookup
   result for a stable redacted account identifier: found/absent, active/inactive,
   and whether a controlled password verification succeeded. Do not export a
   password hash.
4. For the GET, browser network initiator, redirect history, or originating
   monitoring/client configuration. Preserve the request method and URL.

Until these are available, no primary root cause can be named. The source
confirms that GET login is unsupported and the POST 401 has three possible
account/credential causes. The 404 and 401 must be treated as separate events.

## Reproducible local validation and rollback

From a clean checkout, use Node 24 and install from `afrinov-platform/` with
`npm ci`. If the local Windows install reports a locked-file `EPERM`, close
processes that hold files and retry; do not delete `node_modules` as part of
an incident fix or alter the lockfile to bypass the failure.

For unit/static checks, from `afrinov-platform/apps/backend/` run:

```powershell
npm.cmd run lint
npx.cmd tsc -p tsconfig.tools.json --noEmit
npm.cmd test
npm.cmd run build
```

For DB-backed tests, preferably set a separate disposable
`POSTGRES_TEST_PASSWORD`, copy `.env.test.example` to `.env.test`, ensure its URL points to local
`afrinov_test` on port 5433, and set `SEED_ADMIN_PASSWORD` only in the ignored
file or process environment. Then run:

```powershell
docker compose --profile test up -d test-db
npm.cmd run db:test:migrate
npm.cmd run db:test:seed
npm.cmd run test:integration
```

From `afrinov-platform/apps/frontend/`, run
`npm.cmd exec playwright test` after the same test database has been migrated
and seeded. This will launch the real backend and frontend; it was not run in
this investigation.

No deployment, production migration, or account change is included, so no
production rollback is required. If rolling back the source changes, revert
the test isolation/CI/Docker documentation changes together; restore the
previous verifier only if the deployed token contract is verified and a
controlled migration plan explicitly requires another algorithm. Do not roll
back by disabling authentication or accepting multiple algorithms.

## Traceability

| Finding | Corrective change | Regression/preventive control | Verification evidence | Status |
| --- | --- | --- | --- | --- |
| Current login route is POST-only; unsupported GET is 404. | No GET handler added; frontend contract retained. | Route regression asserts GET 404; E2E captures a POST to the exact path. | Backend auth tests passed; Playwright discovery found both E2E specs. | Source contract confirmed; incident caller unresolved. |
| POST 401 can represent unknown account, inactive account, or password mismatch. | No speculative login/account change. | Existing generic response contract retained; closure requires request correlation and authoritative account evidence. | Source trace in `AuthService.login`; no incident DB/log evidence available. | Primary root cause unresolved. |
| Integration/E2E could load developer `.env` and write to its DB. | Isolated `.env.test`, direct local `_test` URL guard with no host overrides, test DB scripts/profile, E2E fixture injection. | Guard unit tests, ignored `.env.test`, separate Compose volume; Playwright discovery only. | Backend suite 813 passed; test URL guard tests included. Migration command could not execute due OS `ENOMEM`; no integration DB run. | Preventive code/config change verified statically/unit level; DB integration pending. |
| JWT verifier did not explicitly pin the signing algorithm. | Sign and verify HS256 explicitly. | Regression tests reject HS384, expired, and tampered tokens. | Focused auth suite 15 passed; full backend suite 813 passed. | Independent security fix; not a cause of the login 401. |
| CI/Docker used unsupported/less reproducible Node/install/build setup and image context could include ignored local `.env` files. | CI and image use Node 24; Docker uses root lockfile, copies sources/schema before build, and `.dockerignore` excludes `.env*` and local artifacts. Startup logs `local-password` mode without secrets. | Backend CI remains executable from the committed workflow; frontend build passed locally. | Static workflow/Dockerfile/ignore review; Docker/CI not run in this environment. | Changes made; cross-machine container/CI validation pending. |
