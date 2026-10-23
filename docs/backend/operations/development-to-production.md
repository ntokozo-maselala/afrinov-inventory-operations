# Development-to-production readiness

Classifications reflect source inspection and the verification recorded in
[verification-and-test-strategy.md](../testing/verification-and-test-strategy.md).
“Verified” means verified within the limits stated; it does not imply a live
production deployment.

| Capability | Classification | Evidence and limit |
| --- | --- | --- |
| Dependency install | Implemented, local clean install blocked | CI and Docker use the workspace lockfile with `npm ci`. Local Windows `npm ci` hit locked-file `EPERM`; recovery install left the lockfile unchanged. Docker image was not built. |
| Reproducible local build | Implemented and verified | `npm.cmd run build` passed on Node 24.21.0. Prisma Client is generated as a prebuild step. |
| Runtime requirements alignment | Implemented in source, CI unverified | README, backend CI, and Docker use Node 24; Vitest 5 requires Node 22.12+. No remote CI run was observed. |
| Configuration validation | Partially implemented | Database URL presence, JWT secret presence/known placeholders, and port range are checked. Secret length/entropy and `NODE_ENV` enumeration are not checked; `CORS_ORIGIN` is not required by code. |
| Authentication and authorization | Implemented, locally verified by unit tests | JWT and DB-backed permission checks exist. No remote identity provider, key rotation, external secret manager, TLS configuration, or deployment verification is provided. |
| Database schema and migrations | Implemented, not verified against a live DB here | 23 migrations and CI's PostgreSQL 16 migration job exist. No migration or DB connection was run in this audit. |
| Seed and bootstrap | Partially implemented | Production seed requires `SEED_ADMIN_PASSWORD` on every invocation because validation happens before existing-admin lookup; it also seeds demo inventory. Compose runs it at every container start. |
| Health and readiness | Implemented and locally verified | `/health` and `/health/ready` behavior was observed with a deliberately unreachable dummy database (200 and 503 respectively). Successful live DB readiness remains unverified. |
| Graceful shutdown | Implemented, partially verified | `SIGINT`/`SIGTERM` close Fastify and Prisma in source. The audit stopped its local process by SIGINT and confirmed the listener closed; production container behavior was not checked. |
| Logging | Partially implemented | Pino request and app logs plus request IDs are configured. No centralized log sink, retention, redaction policy verification, or alerting integration is present. |
| Metrics/tracing/error reporting | Missing | No metrics exporter, tracing SDK, or external error-reporting integration was found. |
| CI checks | Implemented, not remotely verified | `.github/workflows/backend-ci.yml` defines typecheck, lint, unit, build, and real-Postgres integration on Node 24. Workflow was inspected, not executed. |
| Container packaging | Corrected in source, unverified | Dockerfile uses Node 24 and workspace lockfile; Compose build context points at workspace root; root `.dockerignore` excludes local `.env*`. Docker engine was unavailable to build/start it. |
| Deployment and release promotion | Missing | No backend deployment workflow, promotion gates, infrastructure-as-code, release artifact publication, or rollback mechanism was found. Compose is a single-host recipe, not proof of a production deployment. |
| TLS and proxy boundary | Not applicable in backend process; deployment must provide it | Fastify binds plain HTTP; no TLS or proxy config is present. External termination is unknown. |
| Backup and recovery | Missing in repository | Compose uses a named volume but no backup/restore procedure, retention policy, or recovery test exists. |
| Incident response / monitoring | Missing in repository | No alerting, on-call integration, dashboard, SLO, or incident runbook was found. |

## Readiness conclusion

The backend source supports local development and has meaningful unit tests,
typed builds, migration files, real-HTTP tests, a health/readiness distinction,
and a basic Compose recipe. Local typecheck, lint, unit tests, build, and a
no-database liveness/readiness probe passed in this audit.

The repository does **not** establish a verified production path. The Docker
and CI configuration corrections have not been exercised; integration tests
were not run here; no
deployment/release workflow or backup/recovery controls were found; and
production secret validation is incomplete. Do not infer production readiness
from a local TypeScript build or a passing unit suite.

## Recommended gate sequence

1. Build and run the corrected production image in CI against disposable
   PostgreSQL.
2. Execute the Node 24 backend CI jobs and confirm their branch protection.
3. Add runtime validation for allowed `NODE_ENV`, strong JWT key policy, and
   production CORS settings; explicitly guard the any-origin option.
4. Isolate real-HTTP tests to a disposable DB and make the local target
   difficult to misconfigure.
5. Run migration and integration suites against PostgreSQL 16 in CI using the
   actual packaged runtime.
6. Define the external TLS/proxy and secret-management boundary; verify
   health/readiness and graceful termination in that deployment environment.
7. Add and test backups, restore/recovery, logs/metrics/alerts, and a release
   rollback process before production data is treated as recoverable.

The detailed priority, evidence, confidence and approval status for these
items are in the [findings register](../audits/backend-understanding-and-readiness-audit.md).
