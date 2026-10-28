# Engineering baseline assessment

Evidence-based snapshot of the repository's engineering controls, produced
before any change in this workstream. Every check below was executed on the
working tree at commit `59e30ad` (branch `main`); commands and results are in
`VERIFICATION_EVIDENCE.md`. Where a control is missing or blocked, that is
stated rather than assumed.

## 1. What the system is

| Area | Implementation |
|---|---|
| Architecture | Modular monolith. Backend modules: `identity`, `inventory`, `procurement`, `operations`, `reporting`, `settings`, `audit`, `health`, `migration` (boundaries are folder convention, not enforced) |
| Backend | Node.js 24, Fastify 5, TypeScript 6 (strict), Zod 4, Prisma 7 |
| Database | PostgreSQL 16 via Prisma; 27 migrations |
| Frontend | React 19, Vite, Tailwind CSS 4, React Router 7 |
| Auth | JWT HS256 (12h), bcrypt (cost 12); DB-authoritative revocation per request |
| Authorization | Role-based, checked per route via `requirePermission`; roles ADMIN, STORE_CONTROLLER, PROCUREMENT, APPROVER, TECHNICIAN, VIEWER |
| Ledger | ADR-002: `inventory_transactions` append-only through the API; `inventory_balances` recomputed from it; mistakes reversed, not edited |
| Container | Backend Dockerfile (node:24-alpine), docker-compose with PostgreSQL |

## 2. Controls that already existed and work

Confirmed by execution, not inspection:

- Reproducible install: `npm ci` from the workspace-root lockfile — exit 0.
- Strict type checking: `npm run typecheck` (backend `tsc -p tsconfig.tools.json`, frontend `tsc -b`) — exit 0.
- Linting: `npm run lint` (ESLint 9 flat config, both workspaces) — exit 0.
- Unit tests: `npm test` — backend 60 files / 852 tests, frontend 82 files / 856 tests, all passing.
- Production build: `npm run build` — exit 0.
- Backend integration tests against real PostgreSQL: 17 files / 124 tests passing on a fresh database.
- Production dependency audit: `npm audit --omit=dev` — 0 vulnerabilities.
- CI: three workflows (backend, frontend, CodeQL). Backend CI has a real-Postgres integration job. All workflows lint clean under actionlint 1.7.7.
- Test isolation: `requireIsolatedTestDatabaseUrl` rejects any non-loopback or non-`_test` database before a database-backed test runs.
- Concurrency: application-level PostgreSQL advisory locks serialize balance-changing and PO-receipt workflows (work packages 2 and 3 of the prior audit).
- Configuration: `NODE_ENV` validated against an allowlist; production rejects known-insecure and short JWT secrets.

## 3. Confirmed gaps found in this assessment

| ID | Component | Observed condition | Evidence | Severity | Status |
|---|---|---|---|---|---|
| DATA-03 | `prisma/migrations` vs `schema.prisma` | `inventory_balances` declares material/location relations in the schema but no migration ever created the two foreign keys | `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` returned exactly two `AddForeignKey` statements against a freshly migrated database | Medium | Fixed in this workstream |
| AUD-01 | `identity.service.ts`, `material.service.ts`, `project.service.ts`, `settings.service.ts` | These services committed the business change, then wrote the audit row in a separate statement; an audit failure left the change committed with no record | Source inspection plus failure-injection tests that reproduced the orphaned change in each service | Medium | Fixed in this workstream |
| SEC-07 | Git history | A bootstrap admin password (`DEFAULT_ADMIN_PASSWORD`) was committed in `defaultAdmin.ts` and is still present in reachable history | `gitleaks detect` finding at commit `db1501ac0b`; the file is gone from the tree but the blob remains in history | High (if reused) | **Open — rotation required**; see `SECURITY_CONTROLS.md` and `EXCEPTIONS.md` |
| SUPPLY-01 | `.github/workflows` | Actions referenced by mutable tags (`@v4`, `@v7`), not immutable commit SHAs | Workflow inspection | Medium | Fixed in this workstream |
| GATE-01 | CI | No dependency-audit, secret-scanning, or migration-drift gate | Workflow inspection | Medium | Fixed in this workstream |

The prior audit (`audit/07_FINDINGS_AND_READINESS.md`) additionally records
DATA-01, DATA-02, DATA-04, SEC-01 and SEC-02. This assessment re-verified
SEC-01 (fixed in the tree) and DATA-03/AUD-01 (open, now fixed here). DATA-01,
DATA-02 and DATA-04 were fixed by work packages 2 and 3 recorded in
`audit/09_IMPLEMENTATION_LOG.md` and their integration suites pass here.

## 4. Risks that remain outside this workstream's scope

These are real and are carried in `RISK_REGISTER.md`, not silently dropped:

- **OPS-01 (High, release gate):** no deployment workflow, backup/restore
  runbook, verified restore, or alerting evidence in the repository. This is an
  evidence gap; the external environment is not accessible from here.
- **SEC-03 (High if Compose is deployed on a reachable host):** the Compose file
  publishes PostgreSQL on all interfaces and the API uses the initializer
  (superuser) account. Deployment applicability is unknown.
- **SEC-06 (Medium, conditional):** the SPA stores the bearer token in
  `localStorage`; production Content-Security-Policy headers are not defined in
  this repository.
- **ARCH-01 (Medium):** the last active administrator can demote or deactivate
  themselves; the business policy and recovery route are undecided.

## 5. Baseline verdict

The repository is in materially better shape than a green field: install,
typecheck, lint, unit tests, build, integration tests and the production
dependency audit all pass, and the security-critical paths (authentication,
authorization, ledger concurrency, configuration validation) already have
dedicated tests. The gaps are specific and fixable: one missing database
constraint, one atomicity defect, one supply-chain hygiene gap, missing
automated security gates, and one committed credential that must be rotated.

This is a **baseline**, not a production-readiness verdict. Production readiness
requires the OPS-01 operational evidence, which does not exist in this
repository. See `IMPLEMENTATION_ROADMAP.md`.
