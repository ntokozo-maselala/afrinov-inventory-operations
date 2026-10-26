# 00 — Scope and baseline

## Audit purpose and scope

This audit follows the user-provided production-readiness prompt. It assesses architecture, domain invariants, security, data integrity, verification, deployment and operational evidence. It does not certify an externally deployed environment.

No application code, dependency manifest, lockfile, migration, environment file, Git history, database, service or infrastructure was changed. The requested audit reports are the only files added by this work.

## Repository identity and Git baseline

- Repository root: C:/Users/Ntokozo Maselala/afrinov-inventory-operations
- Audit-start branch: main
- Audit-start HEAD: 607a6424d09c79697a95bf4e05311ac33cc25da6
- Audit-start worktree: clean; main tracked origin/main
- Report-generation HEAD: c4a05046f5ab255ae93619f2655b07283f2007d9, still main and origin/main
- The intervening commit only deletes a tracked Word document; it does not change source, manifests, tests, migrations or configuration. The tested application snapshot therefore matches the report-generation application snapshot.
- No user changes were present in the worktree at audit start. The audit reports are untracked additions until committed by an authorized maintainer.

## Applicable instructions and skills

No repository AGENTS.md or nested agent instruction files were found. The user’s pasted audit prompt is the controlling task instruction. It requires read-only investigation first, evidence-backed findings, safe checks only, no secrets in output, and no automatic remediation.

Read and applied the installed Matt Pocock skills for codebase design, domain modeling, research, TDD, diagnosing bugs and code review. The fixed-point branch-review workflow was not applicable to a whole-codebase readiness audit. No subagents were used.

## Repository and runtime inventory

The actual application workspace is afrinov-platform, an npm workspace with apps and packages. Commands for the application are intended to run from that directory. The root package-lock.json is empty; afrinov-platform/package-lock.json is the lockfile that resolves the workspace.

| Area | Verified |
|---|---|
| Runtime at audit | Node v24.21.0, npm 11.19.0 |
| Backend | Node.js, TypeScript, Fastify 5, Prisma 5, PostgreSQL; Zod request validation |
| Frontend | React 18, TypeScript, Vite 8, Tailwind CSS 3, React Router 7 |
| UI libraries | Radix UI primitives are present; a shadcn/ui package was not verified |
| Database image | PostgreSQL 16 Alpine in the backend Compose file |
| Package manager | npm workspaces; platform workspace lockfile |
| CI | GitHub Actions backend/frontend workflows and CodeQL workflow |
| Production deployment | No hosting target, deployment workflow or live production environment was identified |

Express and Supabase were not found in the application implementation. Those were starting hypotheses in the supplied prompt, not verified stack components.

## Environment and safety boundary

Backend environment files exist at apps/backend/.env, apps/backend/.env.test and the example variants. The real .env is not tracked. It was inspected only for non-secret target metadata: its database host is localhost and database name is afrinov. The backend .env.test points to localhost and the separate afrinov_test database on port 5433. No password, JWT value or other secret was printed, copied into this report or transmitted.

The actual .env database was not contacted. Integration/E2E tests, migrations, seeds, database setup/reset scripts, Compose startup/shutdown, Docker builds, imports, deployment and active security scans were withheld. These can touch persistent state, run services or alter a database, and their state and effects were not needed to establish the static risks.

## Checks judged safe and executed

Commands were run in the platform workspace after reviewing scripts and target selection. Unit tests ran with an explicit dummy localhost DATABASE_URL and NODE_ENV=test; no DB connection was used.

| Check | Result |
|---|---|
| Backend unit suite | 57 files and 819 tests passed |
| Frontend unit suite | 76 files and 799 tests passed |
| Backend lint | Passed |
| Frontend lint | Passed |
| Frontend typecheck | Passed |
| Backend package typecheck | Pretypecheck Prisma generation failed with Windows EPERM while replacing a generated query engine file |
| Backend direct TypeScript compile | Passed using tsc -p tsconfig.tools.json --noEmit |
| Backend direct production compile | Passed using tsc -p tsconfig.build.json |
| Frontend production build | Passed; produced bundle warnings recorded in 05 |
| Dependency audit | npm audit reported 4 moderate and 3 high findings overall; production-only audit reported 1 moderate and 2 high package findings |
| Focused configuration probe | Demonstrated NODE_ENV=prod is accepted and bypasses production-only known-secret rejection; it used a public test fixture and a dummy local DB URL, with no service/database connection |

The package typecheck failure and direct compile results are both retained; the failed command is not represented as a pass. Full commands and limitations are in 05.

### Safe command list

After reviewing package scripts, the following read-only or local-only commands were considered safe and executed from the stated workspace:

- From afrinov-platform/apps/backend: vitest.cmd run with NODE_ENV=test and dummy DATABASE_URL pointing only to localhost port 5432 and database audit_test.
- From afrinov-platform/apps/frontend: vitest.cmd run.
- From afrinov-platform: npm.cmd run lint --workspace=@afrinov/backend; npm.cmd run lint --workspace=@afrinov/frontend; npm.cmd run typecheck --workspace=@afrinov/frontend; npm.cmd run build --workspace=@afrinov/frontend.
- From afrinov-platform/apps/backend: npm.cmd run typecheck, tsc.cmd -p tsconfig.tools.json --noEmit, and tsc.cmd -p tsconfig.build.json. The package typecheck's Prisma generate hook failed before TypeScript compilation; the two direct compile commands passed.
- From afrinov-platform: npm audit --json and npm audit --omit=dev --json against the checked-in workspace lockfile.
- A focused local config function probe used a dummy localhost DB URL and a public test fixture. It did not start a service or connect to a database.

Withheld for safety or missing target state: integration/E2E tests, Prisma migrations, seed/setup/reset scripts, workbook imports, Compose up/down, Docker build, any command that connects to the actual .env database, active scans, deployment and production connectivity checks. These were not silently treated as passed.

## First evidence-backed observations

1. Inventory is a signed transaction ledger with a derived inventory_balances table. Application-level balance checks and recomputation have no shared serialization protocol across normal movements.
2. Posting goods receipts checks status and adds ledger effects inside a transaction, but the status transition is not claimed atomically before those effects. Concurrent posts can both observe SUBMITTED.
3. NODE_ENV is asserted to a TypeScript union rather than validated at runtime; configuration branches use exact string comparisons.
4. The only repository-provided Compose database port is published without a loopback host address, and the API connection uses the same configured POSTGRES_USER that initializes the database.
5. Current documentation disagrees with source on the Node image and integration test environment loading.
6. Unit checks and builds pass, but no real-PostgreSQL integration/E2E execution or production deployment/recovery evidence was collected.

## Phase 0 exit

Baseline, instructions, stack, environment boundaries, scripts and safe checks were inspected. Phase 0 exit criteria are met. The next phases trace the architecture and key inventory operations, verify domain/data invariants, assess security and test/deployment evidence, and produce the findings register and remediation roadmap.
