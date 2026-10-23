# Request lifecycle

## Shared HTTP processing

All `/api/v1` feature routes are registered under one Fastify prefix in
`src/server.ts`. Fastify's JSON parser is used with a configured 1 MB body
limit and 30-second request timeout. The app adds a request ID hook, Pino
request logging, CORS, Helmet headers, JWT support, global/auth-specific rate
limits, and one error handler before feature routes are mounted.

For routes with `preHandler: [app.authenticate]`, the route handler does not
run until JWT verification succeeds and PostgreSQL confirms that the subject
still refers to an active user. A handler may then call `requirePermission`,
which loads role-permission rows from PostgreSQL and checks the requested
permission. The roles array in a JWT is not the authoritative permission
source. Route-local Zod parsing follows whichever auth/permission checks the
route declares; it is not uniformly a Fastify schema hook.

## Representative paths

### Liveness and readiness

- `GET /health` and `GET /api/v1/health` are unauthenticated and return
  `{ status: "ok", time }` without a DB call.
- `GET /health/ready` and `GET /api/v1/health/ready` are unauthenticated and
  run `SELECT 1`. Success is 200 with `database: "connected"`; failure is 503
  with `database: "error"` and a log entry.
- Root service identification `GET /` reports service/environment/version.
  These probes are subject to global rate limiting.

### Login

`POST /api/v1/auth/login` is not authenticated, but it is under the strict
login rate-limit budget (default 5 requests per minute per IP). The handler
validates `email` and `password` with Zod. `AuthService.login` looks up the
lowercased email, checks the account is active, and verifies the bcrypt hash.
Invalid credentials produce `UNAUTHENTICATED` (401). On success, Fastify signs
a JWT with `sub`, email, name, and roles claims and a 12-hour expiry; the
response contains the token and user summary.

### Authenticated read: materials

`GET /api/v1/materials` uses `app.authenticate` and does not add a separate
permission check, so any active authenticated account can list materials. The
query string is validated by `listMaterialsQuerySchema`; invalid filters
return 400. `MaterialService.list` builds a Prisma filter, queries materials
with project summary, sorts active items and names, and adds the derived
section field before Fastify serializes the response.

### Authenticated write: inventory issue

`POST /api/v1/inventory-issues` runs authentication first, then checks
`IssueInventory`, then validates the payload with `issueSchema`. The service
validates recipient/project/material/location status, positive quantities,
tool/project-section restrictions, and available balance. It combines
duplicate material/location lines for the stock check. Inside one Prisma
transaction it writes signed negative `ISSUE` ledger rows, recomputes each
affected balance, and prepares domain events. A successful response is 201
with transaction IDs. A missing permission is 403; malformed input is 400;
insufficient balance is 422; expected `ApiError` values use the shared error
shape; unexpected failures are logged and become generic 500 responses.

The route's order has an observable consequence: authentication and
authorization failures happen before the request body is validated. Untrusted
callers do not get a validation response for a protected mutation.

## Error and side-effect boundaries

`server.ts` centrally translates `ApiError` into
`{ error: { code, message, details } }` with the error's status. An unexpected
`Error` is logged with request ID and returned as generic `INTERNAL_ERROR`
500; a non-Error thrown value is also logged and returned as generic 500.
Fastify's own parse errors may follow the generic handler unless a route
handles them explicitly; no global Zod/Fastify schema adapter was found.

The inventory ledger and derived balance writes share the Prisma transaction.
The in-process event dispatcher is called by write services, but no production
event handlers were found. There is no external notification, queue, or durable
outbox in the inspected runtime.

## Request diagram

See [request-flow.mmd](diagrams/request-flow.mmd) for the combined health,
login, read, mutation, and error branches.

## Evidence and limits

The route registrations are in `src/server.ts`, `modules/health/health.routes.ts`,
`modules/identity/auth.routes.ts`, `modules/identity/identity.service.ts`,
`modules/inventory/material.routes.ts`, and
`modules/inventory/inventory.routes.ts`. Inventory rules and transaction code
are in `modules/inventory/inventory.service.ts`; DB-backed authorization is in
`src/shared/authorization.ts`.

The unit suite covers route contracts and mocked service behavior. The
real-HTTP Postgres flow was not run in this audit, so live database behavior
and production networking are not claimed as verified.
