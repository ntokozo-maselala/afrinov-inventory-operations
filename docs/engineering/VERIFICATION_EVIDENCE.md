# Verification evidence

Raw command output backing every claim in `BASELINE_ASSESSMENT.md` and the
final report. Each entry records the exact command, the exit status, and the
key result. Nothing here is marked passing unless it was run and its output
inspected.

Environment: Node v24.21.0, npm 11.21.0, PostgreSQL 16 (Docker), worktree at
`59e30ad` plus the changes described in the final report.

## Static and build checks

| Check | Command | Exit | Result |
|---|---|---|---|
| Install | `npm ci` (from `afrinov-platform/`) | 0 | Lockfile resolved, no audit failures |
| Typecheck | `npm run typecheck` | 0 | Backend + frontend clean |
| Lint | `npm run lint` | 0 | ESLint clean, both workspaces |
| Unit tests | `npm test` | 0 | Backend 60 files / 852 tests; frontend 82 files / 856 tests |
| Build | `npm run build` | 0 | Backend `tsc`; frontend Vite build (chunk-size warning only) |
| Workflow lint | `actionlint .github/workflows/*.yml` | 0 | No findings |

## Dependency security

| Check | Command | Exit | Result |
|---|---|---|---|
| Production audit | `npm audit --omit=dev --audit-level=high` | 0 | 0 vulnerabilities |
| Full audit | `npm audit` | 0 | 0 vulnerabilities (dev included) |

## Database

| Check | Command | Exit | Result |
|---|---|---|---|
| Migrate clean DB | `npx prisma migrate deploy` | 0 | 27 migrations applied to an empty database |
| Drift detection (before fix) | `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` | 0 | Non-empty: two `AddForeignKey` statements for `inventory_balances` (DATA-03) |
| Drift detection (after fix) | same | 0 | `-- This is an empty migration.` — schema and migrations agree |
| Drift exit-code semantics | `... --script --exit-code` | 2 | Confirms a non-empty diff is a failing gate; 0 when empty, 1 on error |
| FK enforcement | `INSERT INTO inventory_balances(...) VALUES ('ghost','ghost2',...)` | 1 | Rejected: `violates foreign key constraint "inventory_balances_material_id_fkey"` |
| Orphan refusal | migrate against a DB seeded with an orphan row | 1 | `ERROR: inventory_balances has 1 orphan material row(s) and 1 orphan location row(s)...`; no partial DDL left (FKs absent) |
| Failed-migration state | `prisma migrate deploy` again after the refusal | 1 | `Error: P3009 — migrate found failed migrations in the target database`; the row in `_prisma_migrations` has `finished_at` NULL |
| Orphan recovery | delete orphan, `prisma migrate resolve --rolled-back 20260101000027_inventory_balance_foreign_keys`, redeploy | 0 | `All migrations have been successfully applied` |

## Integration tests (real HTTP + real PostgreSQL)

| Run | Command | Exit | Result |
|---|---|---|---|
| Full suite, fresh database | `npm run test:integration` | 0 | 17 files / 124 tests passing, 0 skipped |
| Full suite, reused database | `npm run test:integration` | 0 | 17 files / 121 passing, 3 skipped (opening-balance import is once-per-database, by design) |
| AUD-01 regression only | `npx vitest run --config vitest.integration.config.ts integration/identity-audit-atomicity.real-http.test.ts` | 0 | 5/5 passing (user, material, project, settings, plus the successful-update case) |

## Secret scanning

| Check | Command | Exit | Result |
|---|---|---|---|
| Scan (before config) | `gitleaks detect --source . --redact --exit-code 1` | 1 | 7 findings across 296 commits |
| Scan (with placeholder allowlist) | `... --config .gitleaks.toml ...` | 1 | 1 finding — the real historical credential only |
| Scan (with baseline) | `... --config .gitleaks.toml --baseline-path .gitleaks-baseline.json ...` | 0 | No new leaks |
| Negative test | plant a synthetic `ghp_…` token, rescan | 1 | Detected — the gate is not vacuous |
| Baseline content | `grep -c '<secret value>' .gitleaks-baseline.json` | 1 | 0 matches — the baseline stores no secret value |

## Test-first evidence for the fixes

**AUD-01** — with a fix reverted (the project `create` method restored to its
non-transactional shape), the matching failure-injection case fails:

```
AssertionError: expected { …(13) } to be null
 FAIL  … > rolls a project create back when the audit insert fails
 Test Files  1 failed (1)
      Tests  1 failed | 4 passed (5)
```

With the fix restored, the same file passes 5/5. This demonstrates the test
detects the defect rather than merely executing the code path.

**DATA-03** — the drift check output before the migration is the two
`AddForeignKey` statements quoted above; after the migration it is empty.
