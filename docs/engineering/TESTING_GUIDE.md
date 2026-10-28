# Testing guide

The repository already has a layered suite. This guide explains what each layer
is for, how to run it, and what it does and does not prove. Nothing here
replaces the tests themselves; it explains how to use them.

## Layers

| Layer | Location | Count (baseline) | Proves |
|---|---|---|---|
| Backend unit | `apps/backend/src/**/*.test.ts` | 60 files / 852 tests | Business rules, validators, services in isolation (Prisma mocked at the module boundary) |
| Frontend unit / component | `apps/frontend/src/**/*.test.{ts,tsx}` | 82 files / 856 tests | Component rendering, interaction, form validation, states |
| Backend integration | `apps/backend/integration/*.real-http.test.ts` | 17 files / 124 tests | Real HTTP → Fastify → Prisma → PostgreSQL, including authorization and concurrency |
| End-to-end | `apps/frontend/e2e/*.spec.ts` | 1 spec (login) | The browser path through frontend + backend + database |

## Running them

From `afrinov-platform/`:

```sh
npm test                 # both unit suites
npm run typecheck
npm run lint
npm run build
```

Backend integration tests need a real, disposable PostgreSQL database. See
`apps/backend/README.md` ("Running it locally"). In short:

```sh
cd apps/backend
# a database whose name ends in _test, on loopback, configured in .env.test
export SEED_ADMIN_PASSWORD=<throwaway>
DATABASE_URL=postgresql://…/afrinov_test npx prisma migrate deploy
DATABASE_URL=… npx tsx src/db/seed.ts
npm run test:integration
```

The harness refuses any non-loopback or non-`_test` database
(`requireIsolatedTestDatabaseUrl`), so a misconfiguration cannot point the suite
at development or production data.

## What each layer proves — and does not

- **Unit tests** prove logic and edge cases with dependencies mocked. They do
  not prove the database constraints, the HTTP contract, or authorization at the
  boundary.
- **Integration tests** prove the real request path, including role enforcement
  and concurrency. Prefer them for anything that depends on the database,
  transactions, or permissions.
- **E2E** proves the assembled browser path. It is intentionally narrow
  (critical journeys) because browser tests are slow and flaky-prone.

## Conventions that matter

- Integration suites create their own rows with a per-run suffix and leave them
  behind; the ledger is append-only by design. Do not depend on seed data that
  another suite might move.
- `ledgerAndBalance()` asserts the ADR-002 invariant (stored balance equals the
  ledger sum). Use it after any movement.
- The opening-balance import can run once per database, so three of its tests
  skip on a reused database and pass on a fresh one. This is by design, not a
  regression — confirmed by running the full suite against a fresh database
  (124 passed, 0 skipped).
- Failure injection uses test-only PostgreSQL triggers (see
  `integration/identity-audit-atomicity.real-http.test.ts`); the trigger is
  dropped in `afterAll`.

## Adding a test for a defect

1. Reproduce the failure with a test first and record its failing output.
2. Implement the smallest correct fix.
3. Re-run the focused test, then the surrounding suite.
4. Record the evidence (see `VERIFICATION_EVIDENCE.md` for the format).

A test that passes both before and after a fix proves nothing about the defect.
Confirm it fails against the unfixed code before you claim it as a regression
test.
