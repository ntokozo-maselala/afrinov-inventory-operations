# Backend documentation

This is the code-adjacent, evidence-based reference for the backend in
[`afrinov-platform/apps/backend`](../../afrinov-platform/apps/backend/README.md).
It records behavior confirmed from the current implementation and separates
that from intended behavior, historical notes, and unverified deployment
assumptions. The broad product and domain reference remains in
[`afrinov-docs/docs`](../../afrinov-docs/docs/README.md).

## Five-minute backend understanding brief

Afrinov's backend is a single Node.js process that serves a Fastify 5 REST API
written in TypeScript. It is a modular monolith: identity, inventory,
procurement, operations, reporting, settings, audit, and health code is grouped
by feature under `src/modules`, but those folders are conventions rather than
independently enforced boundaries. Route handlers call feature services;
services and some route modules use one shared Prisma client directly. There is
no separate repository layer, message broker, background worker, scheduler, or
external identity provider in the inspected backend.

The process entry point is `src/index.ts`. The local development script runs
`tsx watch --env-file=.env src/index.ts`; the compiled start script runs
`node dist/index.js` and expects its environment to be provided by the caller.
Startup validates `DATABASE_URL`, `JWT_SECRET`, and `PORT`, creates Fastify,
registers CORS, Helmet, JWT, rate limiting, error handling, health and feature
routes, probes PostgreSQL without blocking listener startup, then binds the
configured host and port. `SIGINT` and `SIGTERM` close Fastify and disconnect
Prisma.

PostgreSQL 16 is accessed through Prisma 5. The inventory ledger is
`inventory_transactions`; each stock movement writes signed decimal ledger
rows and recomputes `inventory_balances` in a Prisma transaction. Application
rules prevent negative stock, but the schema has no database check constraint
that independently enforces that rule. There are 22 committed migrations.

Login is email/password with bcrypt hashes and 12-hour signed JWTs. Protected
routes verify the bearer token, look up the account's current active state,
and check permissions loaded from role-permission rows. Rate limiting,
security headers, allow-list CORS, request IDs, Pino request logs, generic
500 responses, and root plus API-prefixed health probes are configured in
`server.ts`.

Local typecheck, lint, build, and unit tests passed in this audit on Node
24.21.0. The unit suite reports 823 passing tests across 57 files. The
real-PostgreSQL integration suite and container build were not run: this
environment has no Docker executable or local `.env`, and integration tests
write rows to the database named by `DATABASE_URL`. The tracked CI workflow
selects Node 20 even though installed Vitest 5 declares Node `^22.12.0 ||
^24.0.0 || >=26.0.0`. The Dockerfile also reaches its build command before
copying application source and Prisma schema. Treat both paths as unverified
release blockers until corrected and exercised.

There is no verified production deployment pipeline, external secret manager,
metrics/tracing/alerting stack, or backup/restore procedure in this repository.
The Docker Compose file is a single-host PostgreSQL/API recipe; its API command
applies migrations and runs the demo seed before startup. It is not evidence
that a production deployment has been completed.

## Document map

| Document | Purpose and audience | Canonical topic |
| --- | --- | --- |
| [System inventory](architecture/system-inventory.md) | Developers and operators locating components and commands | Package, modules, dependencies, tests, infrastructure |
| [Backend architecture](architecture/backend-architecture.md) | Developers reviewing ownership and dependency direction | Actual modular-monolith structure and component diagram |
| [Request lifecycle](architecture/request-lifecycle.md) | API developers and security reviewers | Representative HTTP paths and ordering |
| [Codebase navigation](architecture/codebase-navigation.md) | Developers entering or debugging the backend | File-to-responsibility map |
| [Component diagram](architecture/diagrams/backend-components.mmd) | Architecture reviews | Runtime components and confirmed/uncertain edges |
| [Lifecycle diagram](architecture/diagrams/backend-lifecycle.mmd) | Developers and operators | Startup, listen, request availability, shutdown |
| [Request-flow diagram](architecture/diagrams/request-flow.mmd) | API and security reviews | Health, authenticated read, login, mutation and error branches |
| [Environment configuration](configuration/environment-configuration.md) | Developers and deployment operators | Environment distinctions and full settings matrix |
| [Environment variable reference](configuration/environment-variable-reference.md) | Developers and operators | Variable names, consumers, safe defaults, and caveats |
| [Persistence and database lifecycle](data/persistence-and-database-lifecycle.md) | Developers and database operators | Schema, ledger, transactions, migrations, seed, recovery gaps |
| [Authentication and security model](security/authentication-and-security-model.md) | Security reviewers and API developers | Identity, JWT, authorization, headers, CORS and findings |
| [Verification and test strategy](testing/verification-and-test-strategy.md) | Developers and CI owners | Test scope, commands, observed results and gaps |
| [Development-to-production assessment](operations/development-to-production.md) | Technical leads and operators | Readiness classifications and deployment limitations |
| [Runtime lifecycle](operations/runtime-lifecycle.md) | Developers and operators | Commands, initialization order, readiness and shutdown |
| [Runbook](operations/runbook.md) | Developers and on-call operators | Safe setup, diagnosis and recovery procedures |
| [Audit findings register](audits/backend-understanding-and-readiness-audit.md) | Owners prioritizing remediation | Prioritized, evidence-backed findings and next steps |

## Evidence and freshness

This audit was performed on 2026-10-23 against the working tree. Source paths
and symbols are linked from each topic document. Verification commands and
their results are recorded in the test strategy. Source inspection establishes
configured behavior; it does not establish that a remote deployment, live
database, Docker image, backup, or production secret-management system works.

Earlier backend audits under [`docs/audits/backend`](../audits/backend/) and
the architecture, security, testing, and operations references in
`afrinov-docs/docs/` are useful historical or intended-state context. Where
they differ from current code, follow the current code and this audit until
the discrepancy is resolved.
