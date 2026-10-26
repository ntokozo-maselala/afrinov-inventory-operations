# 03 — Security review

## Controls observed

- Password hashing uses bcryptjs cost 12. Login uses generic credential failure responses.
- JWT uses HS256, expires after 12 hours, and verification restricts accepted algorithms.
- Authenticated requests reload the active user and current role/permission state from the database.
- Fastify registers Helmet and rate limiting. Login has a lower limit than the global API limit.
- Domain routes use authentication and permission checks; report access requires ViewReports.
- API docs are disabled by default only when NODE_ENV equals the exact string production.
- CORS is closed when no production origin is configured. An explicit CORS_ALLOW_ANY=true switch reflects any origin; the frontend sends bearer tokens from localStorage rather than cookie-based auth.
- Prisma queries are parameterized. Inspected raw SQL uses tagged templates or static statements. No unsafe raw query, direct HTML injection sink or upload endpoint was found in the searched application sources.
- The actual backend .env is untracked and ignored. Its contents were not displayed.

## Findings

### SEC-01 — NODE_ENV is not validated at runtime; production secret checks can be bypassed

shared/config.ts casts the environment string to a TypeScript union. This is erased at runtime. Production checks compare against the exact string production. A local, database-free probe with NODE_ENV=prod was accepted by loadConfig and accepted a known public test fixture that exact production would reject. Because API docs default on unless the environment equals production, a typo also changes production behavior.

Impact: a deployment typo can bypass rejection of repository-known JWT secrets and enable development-only defaults. In addition, production accepts any nonempty secret not on the exact denylist; there is no minimum entropy/length validation. This is a confirmed configuration validation defect; impact depends on the configured value and deployment environment.

### SEC-02 — Dependency audit reports vulnerable production dependency paths

The platform lockfile audit reported 4 moderate and 3 high package findings overall. Production-only audit reported 1 moderate and 2 high package findings. Zod 3.25.76 is affected by GHSA-mrhx-c7xc-m3w5 for memory exhaustion with oversized arrays that have no maximum length. The repository declares Zod 3 and report query arrays for category, locationId, supplierId and materialId have no .max() bound. The affected API paths require ViewReports; exploitation was not attempted. fast-uri 3.1.8 is affected by GHSA-w74x-v6f9-j3xg and is in the Fastify production dependency graph. The audit's proposed Zod fix crosses a major version boundary, so upgrade compatibility must be evaluated rather than applied blindly.

The full audit also lists development-only findings, including Tailwind/PostCSS and undici. They are not included in the production-only result.

### SEC-03 — Compose DB is published on all host interfaces and API uses initializer account

The main Compose database maps 5432:5432 without a host IP, which Docker publishes on all host interfaces by default. The backend DATABASE_URL uses the same POSTGRES_USER passed to the official Postgres image; that image initializes this account with superuser privileges. If this Compose file is reachable from an untrusted network or used as a production topology, database exposure and API compromise have excessive impact. Repository evidence does not establish whether this file is actually deployed.

### SEC-04 — CORS wildcard switch is not constrained by environment

resolveCorsOrigin returns wildcard/reflected origin whenever CORS_ALLOW_ANY=true, including production, while the server also sets credentials=true. The current app uses explicit bearer tokens and no cookie session was identified, so this is a hardening concern rather than a demonstrated CSRF or data-exposure vulnerability. Production config should reject the switch or require an explicit reviewed exception.

### SEC-05 — Rate-limit identity depends on deployment topology

Rate limiting keys by request IP and the Fastify server does not configure trustProxy. Behind a reverse proxy, requests may all appear to come from one proxy address unless proxy handling is deliberately configured. The rate limiter is in-memory per process, so it also does not aggregate across replicas. This may cause shared throttling or weaker cluster-wide limits; the actual topology is unknown.

### SEC-06 — Browser token storage makes XSS impact high

The SPA stores the bearer token in localStorage. No obvious injection sink was found in the searched code, but any successful same-origin script injection could read the token. This is an architectural exposure to consider alongside the static host's Content Security Policy and dependency hygiene; the repository does not define the production static-host security headers.

## Upstream advisory references

- Zod GHSA-mrhx-c7xc-m3w5: https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- fast-uri GHSA-w74x-v6f9-j3xg: https://github.com/advisories/GHSA-w74x-v6f9-j3xg

## Phase 3 exit

Authentication, authorization, configuration, CORS, rate limits, token storage, query safety and dependency audit were examined. No secrets were disclosed or active exploitation performed. Deployment secret quality, TLS termination, static-host headers and actual rate-limit topology remain unverified.
