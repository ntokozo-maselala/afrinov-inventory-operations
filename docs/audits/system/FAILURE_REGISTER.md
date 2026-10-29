# Failure Register

**Date:** 2026-10-12. Findings describe the checked-out repository at `e2063cf` plus the single install-policy change recorded during recovery. Confidence: confirmed unless stated otherwise.

| ID | Severity / confidence | Area | Evidence and impact | Resolution / next action | Verification / acceptance |
|---|---|---|---|---|---|
| F-01 | P0 / confirmed, recovered | Install tree and npm lifecycle | Initial `npm ls` showed unmet backend workspace and root `cross-env`; Prisma, `tsx`, and `cross-env` commands were missing. Typecheck/build/dev/test commands failed downstream. npm 11 also withheld Prisma and esbuild lifecycle scripts. | Rebuilt dependencies with `npm.cmd ci`; recorded four targeted `allowScripts` approvals in `afrinov-platform/package.json`. | Typecheck, lint, all unit tests, and workspace build now pass. A future clean `npm ci` should be verified on the team's standard npm/CI versions. |
| F-02 | P0 / confirmed, recovered — **superseded, see re-verification** | Tailwind/PostCSS | Current frontend lock/install resolves Tailwind 3.4.19 with existing v3 PostCSS config/CSS. The historical Tailwind v4 PostCSS error in untracked `build-errors.md` does not reproduce. Root also contains transitive Tailwind 4.3.3, but frontend build succeeds with workspace-local v3. | No Tailwind/PostCSS change made. Keep version/config aligned; assess the audit's v3-to-v4 suggestion only as a planned migration. | Normal and frontend-only production builds pass. |
| F-03 | P1 / confirmed, recovered | Typecheck and build | Initial root `npm run typecheck` reached backend `pretypecheck`, then failed because `prisma` was missing; frontend had unresolved/missing type declarations while install was partial. With dependencies in place but engine download blocked, Prisma generation failed at `binaries.prisma.sh`. | Install dependencies and allow Prisma engine setup; engine download completed after network access was allowed. No TypeScript source workaround was needed. | `npm run typecheck` and `npm run build` both pass from `afrinov-platform/`. |
| F-04 | P1 / confirmed, environment — **superseded, see re-verification** | Backend startup | `npm run dev` in `apps/backend` fails with `node: .env: not found`. Config requires `DATABASE_URL` and `JWT_SECRET`; neither a local `.env` nor Docker CLI is present. | Follow backend README: create a local `.env`, generate a unique local JWT secret, start PostgreSQL, apply migrations/seed only against the intended local DB, then start backend. | Backend server/readiness and integration tests remain blocked until prerequisites are provided. |
| F-05 | P1 / confirmed, invocation | Command roots | There is no root `package.json`; `npm` at repo root fails. `afrinov-platform/package.json` has no `dev` script. `dev:frontend-only` exists only in frontend workspace; backend `dev` is app-local. | Use documented working directories and explicit workspace aliases: `npm run dev:backend` / `npm run dev:frontend` from platform root; frontend-only command from frontend root. | Frontend-only invocation succeeded. Root generic `npm run dev` was reproduced as Missing script. |
| F-06 | P1 / confirmed, external | Prisma engine and advisory network | In sandbox, Prisma generation and npm audit advisory requests failed to reach external hosts. Engine generation succeeded after network approval; audit succeeded after network approval. | In restricted networks, allow registry and Prisma binary endpoints or use a pre-provisioned cache/mirror. | Prisma generate/typecheck/build pass; dependency audit completed. |
| F-07 | P1 / confirmed, operational — **superseded, see re-verification** | Database and integration coverage | Docker is not installed; no local database was available. Backend integration suite, migrations, seed, and live frontend/API flow were not run. | Provide PostgreSQL 16 and a test-only database; migrate/seed only the disposable test DB, then run `npm run test:integration` from backend workspace. | Still BLOCKED; do not infer from mocked unit tests. |
| F-08 | P1 / confirmed, security — **superseded, see re-verification** | Dependency advisories | `npm audit` reports 7 dev-tree vulnerabilities (2 moderate, 5 high), with `braces`/`micromatch` and PostCSS selector chain reached through Tailwind 3.4.19. `npm audit --omit=dev` reports 0. npm's only offered automatic fix forces Tailwind 4.3.3. | Review a minimal compatible dependency remediation or schedule/test a Tailwind v4 migration. Do not run `npm audit fix --force` as a blind repair. | Audit reproduced; no dependency changes made. |
| F-09 | P2 / confirmed, unsupported pairing — **superseded, see re-verification** | Vite plugin compatibility | Manifest resolves Vite 8.2.2 with `@vitejs/plugin-react` 4.7.0; the plugin declares peer support only through Vite 7. | Align the React plugin and Vite to a mutually supported pair in a focused dependency change, then rerun dev, tests, and builds. | Current Vite 8 dev/build pass despite the declared peer mismatch; future/other paths remain at risk. |
| F-10 | P2 / confirmed | npm on PowerShell | Calling `npm` selects `npm.ps1` and fails under the machine execution policy. `npm.cmd` works and reaches project scripts. | On this machine use `npm.cmd`; alternatively adjust local PowerShell policy only if the developer intends to run npm's PowerShell shim. | Reproduced; project code is unaffected. |
| F-11 | P2 / confirmed, known debt — **superseded, see re-verification** | CI/runtime and production readiness | Backend CI and Dockerfile use Node 20, while frontend tooling and CI require newer Node. Existing debt register also records DB FK/ledger immutability/audit gaps, broad authenticated reads, untested paths, and hard-coded E2E credential. | Track under existing technical-debt/security work; update CI/runtime and close data-integrity/authorization gaps before any production claim. | Code/docs inspection only; CI and production controls were not exercised here. |
| F-12 | P3 / confirmed — **superseded, see re-verification** | Frontend build warnings | Builds succeed but Vite reports plugin config deprecations; ExcelJS emits direct `eval` warning and a 1.06 MB minified chunk warning. | Review plugin compatibility and ExcelJS export loading/bundle size separately; not a blocker for current builds. | Warnings reproduced in both production build modes. |
| F-13 | P3 / confirmed | Repository metadata | Root `package-lock.json` exists without root `package.json`; active workspace root is `afrinov-platform/`. | Keep commands and lock operations rooted at the platform. Decide separately whether the legacy root lock should be retained; it was not modified. | Root `npm run dev` fails; platform lockfile install succeeds. |

## Relationship summary

- F-01 caused the initial tool-not-found and module-resolution failures (F-03) and prevented reliable CSS/runtime diagnosis.
- F-02 was historical and is independent of the original partial dependency state; it is currently resolved by matching Tailwind v3 configuration and frontend install.
- F-04 and F-07 are local setup/infrastructure blockers, independent of compiler success.
- F-05 and F-10 are invocation/shell issues, independent of application source.
- F-08, F-09, F-11, F-12, and F-13 are residual risks or maintainability findings; none prevented the verified current frontend/backend build and unit-test gates.

## Re-verification — 2026-10-29 (working tree)

Findings F-02, F-08 and F-09 were re-checked against the current working tree.
Where this register and the code disagree, the code wins; the entries below
supersede the 2026-10-12 rows for those three findings.

| ID | Status now | Evidence |
|---|---|---|
| F-02 | **Resolved; root cause identified** | The frontend resolves `tailwindcss@4.3.3` and `@tailwindcss/postcss@4.3.3` from the platform lockfile (there is no workspace-local Tailwind). `apps/frontend/postcss.config.js` uses the v4 plugin (`'@tailwindcss/postcss'`) and `src/index.css` uses `@import 'tailwindcss'`, so the pipeline is correct for v4. The historical `postcss-import: … tailwindcss/lib/index.js:1:1: Unknown word "use strict"` came from running the **v3** PostCSS setup against **v4**: v4's package `exports` map has no `./lib/index.js` and its JS entry is `dist/lib.mjs`, so a v3-style config that required the v3 `lib/index.js` path (or `postcss-import` treating the JS entry as CSS) fails with exactly that message. It does not reproduce now: `vite build` emits `tailwindcss v4.3.3` CSS, and the dev server serves `/src/index.css` with no PostCSS error. |
| F-08 | **Resolved** | `npm audit` and `npm audit --omit=dev` both report `found 0 vulnerabilities`. The 7 dev-tree advisories reached through Tailwind 3.4.19 are gone now that the tree is on Tailwind 4.3.3. |
| F-09 | **Resolved** | `@vitejs/plugin-react@6.1.2` declares `peerDependencies.vite: ^8.0.0`, and the tree resolves `vite@8.3.5` — a mutually supported pair. The old 4.7.0/8.2.2 mismatch is no longer present. |

Still open: F-13 (legacy root lockfile, untracked decision). See
`afrinov-docs/docs/12-operations/error-handling.md` for the error-handling
behaviour and its test coverage.

## Re-verification — 2026-10-29 (second pass, live infrastructure)

F-04, F-07 and F-12 were re-checked with a real PostgreSQL 16 container and
Playwright browsers installed. Where this register and the code disagree, the
code wins; the entries below supersede the 2026-10-12 rows for those findings.

| ID | Status now | Evidence |
|---|---|---|
| F-04 | **Resolved** | Backend startup is not blocked. With `apps/backend/.env.test` (a local `.env` is unnecessary for tests), `prisma migrate deploy` applied all migrations, `npm run db:seed` created `admin@afrinov.local`, and the backend served the integration suite against a live database. |
| F-07 | **Resolved** | A PostgreSQL 16 container (`postgres:16`) on `localhost:5432` with a `_test`-suffixed database unblocked the suites. `npm run test:integration --workspace=@afrinov/backend` passed 17 files / 124 tests (3 conditional skips), and the Playwright suite passed 7/7 (real backend, real Postgres, real Vite proxy). The rows previously covered by unit tests only are now covered end to end. |
| F-12 | **Resolved** | A clean `vite build` now reports zero warnings: no plugin-config deprecation, no `eval` warning and no chunk-size warning. The largest chunk (`exceljs.min`, 929 kB) sits under the configured `chunkSizeWarningLimit: 1000` and is lazily imported by the export actions, so it never affects first paint. |

## Re-verification — 2026-10-29 (third pass, Node runtime)

F-11 was re-checked against the workflows and the container definition.

| ID | Status now | Evidence |
|---|---|---|
| F-11 | **Resolved** | Every CI job pins Node 24 — `backend-ci.yml` (all three jobs), `frontend-ci.yml`, `security-ci.yml` — and `apps/backend/Dockerfile` builds and runs on `node:24-alpine`. The "backend on Node 20" claim was stale: the runtime mismatch (Vitest 5 on Node 20) no longer exists. The wider production-readiness items the row also mentioned (DB FK/ledger immutability/audit gaps, broad authenticated reads, untested paths, the hard-coded E2E credential) are tracked in their own findings and are not closed by this change. |

## Re-verification — 2026-10-29 (fourth pass, Qodo review of the error-handling change)

Qodo's review of PR #114 raised 13 findings against the new error-handling code
(3 high, 10 medium). All 13 were checked against the code and confirmed real;
all are now fixed and covered by tests. Where this register and the code
disagree, the code wins.

| ID | Severity | Defect and fix | Tests |
|---|---|---|---|
| Q-01 | High | A late 401 for a token replaced by a newer sign-in signed the new session out. The 401 handler now emits the rejected token and the auth provider ends the session only if it is still current. | `auth.test.tsx`, `client.test.ts` |
| Q-02 | High | A 401 from `/auth/login` (bad credentials) or an untokened 401 raised the session-expired event. Neither emits it now. | `client.test.ts` |
| Q-03 | High | Changing Settings tabs remounted the layout (boundary keyed on `pathname`) and dropped the unsaved draft. The layout route now passes a stable `resetKey`; leaf routes keep the pathname key. | `App.test.tsx` |
| Q-04 | Medium | The Issue-stock form was hidden whenever the stock list had any error, including a stale-but-usable refresh. It now renders for a stale source and blocks only on a hard failure. | `useApiStale.test.tsx` (policy) |
| Q-05 | Medium | `usePagedList` dropped the first page's `stale`, so a failed refresh became a hard error for paged consumers. It is forwarded now; report and activity pages show the stale notice. | `usePagedList.test.tsx` |
| Q-06 | Medium | Errors raised by route handlers directly (bypassing the central handler) omitted `requestId` from the body. An `onSend` hook now injects it centrally, with `withRequestId` as the pure helper. | `errors.test.ts` |
| Q-07 | Medium | Domain codes fell through to the "unexpected defect" default in `errorPresentation`, so a validation or conflict read as a system fault with a retry. Domain codes now map to warning tone and no retry. | `errorPresentation.test.ts` |
| Q-08 | Medium | `networkError` did not know the HTTP method, so a timed-out mutation looked like a retryable read timeout. It now takes the method and returns `OUTCOME_UNKNOWN` for writes, and writes get a longer timeout. | `client.test.ts` |
| Q-09 | Medium | An unmapped Prisma code fell through to a bare 500. `classifyPrismaError` now returns null for unmapped codes so the central handler logs them as defects. | `errors.test.ts` |
| Q-10 | Medium | The message-safety heuristic rejected legitimate domain text shaped like a driver code (`P1001`, "Error Log Sheet"). It now matches only the real driver forms (`code: 'P2002'`, `prisma.…`). | `client.test.ts` |
| Q-11 | Medium | On Receive/Return/Count, one stale option list masked a hard failure in another, leaving a form with an empty list. Each required list is now judged on its own. | `useApiStale.test.tsx` (policy) |
| Q-12 | Medium | A 403 refresh still marked data stale, showing protected cached rows as "last data that loaded". `stale` is now cleared for `FORBIDDEN`/`UNAUTHENTICATED`. | `useApiStale.test.tsx` |
| Q-13 | Medium | Error toasts do not auto-dismiss and were unbounded, so a long outage filled the screen. The stack is capped at three (newest kept) and dedupe entries are evicted. | `Toast.test.tsx` |

Gates after the fixes: typecheck, lint and production build clean; backend 882
tests, frontend 962 tests, all passing.

## Re-verification — 2026-10-29 (fifth pass, idempotent inventory mutations)

The remaining gap in the error-handling workstream was TD-019/ARCH-02: an
interrupted inventory mutation could be double-posted by an explicit retry.
Inventory mutations now carry a server-side idempotency key. Where this
register and the code disagree, the code wins.

| ID | Status now | Evidence |
|---|---|---|
| F-14 | **Resolved for inventory** | Every inventory mutation route (`/inventory-issues`, `/inventory-transfers`, `/inventory-adjustments`, `/stock-counts`, `/stock-receipts`, `/inventory-returns`, `/inventory-transactions/:id/returns`, `/inventory-transactions/:id/reversal`) accepts an optional `Idempotency-Key` and runs through `withIdempotency` (`src/shared/idempotency.ts`). The operation and the stored key commit in one transaction (the new `idempotency_keys` table, migration `20260101000030_idempotency_keys`), so a repeat with the same key replays the stored status and body (`Idempotency-Replayed: true`) and posts nothing; a key reused with a different body — or, via the request-scoped hash, a different record — is refused `409 CONFLICT`. A failed attempt stores no key, so a genuine retry still runs. The frontend mints one key per submission (`src/lib/idempotency.ts`) across all five mutation forms and rotates it only after a confirmed success. Covered by `integration/idempotency.real-http.test.ts` and `src/lib/idempotency.test.ts`; the remaining write endpoints (procurement, master data) are not yet keyed and stay tracked under TD-019. **Superseded by the sixth pass below**, which hardens the store (invalid-key refusal, distinct reuse code, concurrency lock, retention sweep) and the client key lifecycle. |

## Re-verification — 2026-10-29 (sixth pass, Qodo review of the idempotency change)

Qodo's review of PR #116 raised 8 findings against the idempotency work. All 8
were checked against the code and confirmed real; all are now fixed and covered
by tests. Where this register and the code disagree, the code wins.

| ID | Severity | Defect and fix | Tests |
|---|---|---|---|
| F-14a | High | Count stock posted without a key, so a retried count could double-adjust the ledger. `StockCount.tsx` now sends a keyed request through `useIdempotencyKey`. | `StockCount.test.tsx` |
| F-14b | High | A pending key lived only in a module `Map`, so navigating away to verify an unknown-outcome write and returning lost it, and a later submission reused a stale key. Keys are now persisted in `sessionStorage`, bound to (operation, payload), and read lazily so they survive unmount. | `idempotency.test.ts` |
| F-14c | Medium | A blank or over-long `Idempotency-Key` was silently ignored, so a caller that meant to be retry-safe ran unkeyed. A present-but-invalid key is now refused `400 VALIDATION_ERROR`. | `idempotency.test.ts`, `idempotency.real-http.test.ts` |
| F-14d | Medium | Changing the recipient on a return kept the old key, so the new return reused a key bound to the previous payload. The recipient change now mints a fresh key. | `ReturnStock.test.tsx` |
| F-14e | Medium | The transaction drawer's return/reversal forms shared one key across records and rotated via an effect, so a re-opened drawer could reuse or lose a key. The key is now scoped by operation and transaction id. | `TransactionDrawer.test.tsx` |
| F-14f | High | Two concurrent requests with the same key both passed the pre-check and both ran, double-posting. The store now serialises on a transaction-scoped advisory lock and re-looks-up inside the transaction, so the loser replays. | `idempotency.real-http.test.ts` |
| F-14g | Medium | A reused key answered a generic `409 CONFLICT`, indistinguishable from a business conflict, so the client retried a permanent failure forever. It now answers `409 IDEMPOTENCY_KEY_REUSED` and the client clears the key. | `errorPresentation.test.ts`, `idempotency.real-http.test.ts` |
| F-14h | Medium | Stored keys were never removed, so `idempotency_keys` grew without bound. An hourly prune sweep (24h retention) now runs from server startup. | `idempotency.test.ts` |
