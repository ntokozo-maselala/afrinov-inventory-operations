# 06 — Deployment and operations

## Build and delivery path

The backend Dockerfile uses Node 24 Alpine build/runtime stages, installs from the platform lockfile, generates Prisma client, compiles TypeScript, prunes development dependencies and runs as the unprivileged app user. Frontend build passed locally. The backend TypeScript production compile passed, but a Docker build was not run.

GitHub Actions has backend and frontend quality workflows. The backend workflow includes a PostgreSQL 16 service for integration tests, migrations and seed in CI. CodeQL workflow exists. No deployment workflow, production hosting configuration, deployment permissions, release environment or actual target topology was identified.

## Compose topology and risks

apps/backend/docker-compose.yml defines:

- PostgreSQL 16 Alpine with a persistent named volume.
- Main DB host mapping 5432:5432 without loopback address.
- Test DB behind the test profile, separate volume and loopback-only mapping 127.0.0.1:5433:5432.
- Backend API host mapping 4000:4000.
- Backend DATABASE_URL assembled with the same POSTGRES_USER used to initialize Postgres.
- NODE_ENV defaults to production and JWT_SECRET is required.
- Container startup runs prisma migrate deploy, the compiled seed, then the API.

Docker publishes a port on all host interfaces when the host IP is omitted. The official Postgres image documents that POSTGRES_USER creates a database superuser. If this Compose topology is exposed beyond a trusted local host, the DB has direct network exposure and the API connects with superuser privileges. The repository does not establish whether Compose is the production deployment path. Use a restricted runtime role and do not publish the production DB port; limit development/test bindings to loopback.

## Configuration and lifecycle

Configuration validates database URL presence, JWT secret emptiness/known placeholders, port range, CORS and API docs. The runtime NODE_ENV enum is not actually validated, and production defaults depend on exact-string equality; see SEC-01.

The API exposes liveness and readiness probes. Readiness checks database availability. Startup migration and seed behavior is coupled to backend container startup, which means every new container startup executes these lifecycle steps. Migration 22 requires a prior-release data conversion and safely fails if rack rows remain. No separate migration job, canary or automated rollback path was found.

The migration history is forward-only and documentation explicitly says there are no down migrations. A rollback may require an application rollback compatible with the current schema or a separately designed corrective migration; restoring a backup would need a verified procedure.

## Runtime version and documentation drift

The code Dockerfile uses node:24-alpine. afrinov-docs/docs/06-system-architecture/deployment-architecture.md still describes node:20-alpine. Onboarding documentation says integration config reads .env, while current backend integration config reads .env.test only and rejects remote/non-_test targets. Current backend README describes the safer .env.test-only behavior.

## Operational readiness evidence missing

- No confirmed production host, network boundary, TLS termination or static frontend host.
- No backup schedule, retention policy, encrypted backup evidence, restore rehearsal or recovery objectives in repository evidence.
- No production log aggregation, metrics, alerting, tracing or incident runbook identified.
- No verified capacity/resource limits, database pool sizing, request timeout policy or multi-replica rate-limit design.
- No deployment smoke, migration rehearsal, rollback rehearsal or disaster recovery evidence.
- No evidence of actual production secret entropy, rotation, access controls or injection mechanism.
- No proof that API or DB ports are firewalled in the actual deployment.

## Release-readiness checklist

Before a release decision, the deployment owner should provide the actual topology and prove:

1. Database is private, runtime credentials have least privilege, backups are restorable and recovery targets are accepted.
2. NODE_ENV and secrets are validated at startup; frontend and API are served over TLS with reviewed security headers.
3. Migrations are rehearsed against a production-like copy, including the rack conversion path, and rollback/correction steps are documented.
4. Isolated PostgreSQL concurrency tests pass for stock invariants and receipt idempotency/state transitions.
5. Deployment health, logs, alerts and on-call ownership are known, and readiness/liveness behavior is verified.
6. Dependency advisories are remediated or explicitly accepted by security ownership.

## Phase 6 exit

Build scripts, containerization, CI, environment configuration, migration/startup coupling and repository operational evidence were assessed. Repository evidence does not establish production deployment safety or recoverability. Phase 6 exit criteria are met for assessment, but operational release gates remain open.
