# 01 — Architecture map

## Verified component map

~~~mermaid
flowchart LR
  Browser[React SPA] -->|Bearer token, /api/v1| API[Fastify API]
  API --> Auth[JWT authentication and current-user lookup]
  API --> Modules[Identity, inventory, procurement, operations, reports, settings, audit]
  Modules --> Services[Domain services and Zod schemas]
  Services --> Prisma[Prisma client]
  Prisma --> PG[(PostgreSQL)]
  Services --> Ledger[Inventory transaction ledger]
  Ledger --> Balances[Derived inventory balances]
  CI[GitHub Actions] --> Backend[Backend checks]
  CI --> Frontend[Frontend checks]
  Backend --> PG
~~~

The frontend entry is apps/frontend/src/main.tsx, which mounts AuthProvider and the application. App.tsx lazy-loads page modules. The API client adds the bearer token and calls /api/v1. Vite proxies /api to the local backend during development. The frontend also has a guarded demo/mock build path.

The backend entry is apps/backend/src/index.ts and server.ts. Fastify registers CORS, Helmet, JWT, rate limiting, health routes, OpenAPI and domain route modules under /api/v1. Domain services call a shared Prisma client against PostgreSQL. There is no separate repository layer everywhere; domain services and Prisma access form the persistence boundary.

## API module and protection inventory

The route group list below summarizes the registered API surface; individual method/path definitions live in the linked route modules and generated OpenAPI document.

| Route group | Module | Protection observed |
|---|---|---|
| Login and current user | identity/auth.routes.ts | Login is public; current-user endpoint requires a valid bearer token |
| User administration | identity/user.routes.ts | Authenticated, with route-level permission checks |
| Materials, locations, stock, movements, receipts, transfers, counts, returns and reversals | inventory route modules | Authenticated; write routes apply specific permissions |
| Suppliers, purchase orders and goods receipts | procurement route modules | Registered behind procurement feature flag; authenticated and permission-checked |
| Inventory and operational exports/reports | reporting route modules | Authenticated and report permission-checked |
| Settings and audit log | settings and audit route modules | Authenticated; writes and audit reads have narrower permissions |
| Health and readiness | server.ts and health module | Public operational probes |

The server exposes public /health and /health/ready routes. Other non-login domain routes use the authenticate prehandler. Authorization uses named permissions derived from current database role/permission state rather than trusting role claims alone. Login returns a signed JWT; the frontend stores it in localStorage.

## Representative end-to-end flows

### View inventory

The SPA calls the reports/inventory or inventory listing API through the shared client. Fastify validates query input with Zod, authenticates the bearer token and checks ViewReports or the route’s applicable read permission. Reporting services query materials, locations, transactions and/or derived balances through Prisma. Results are mapped to API response objects; the frontend handles loading/error states through its API hooks.

### Create or edit a material

An authenticated write route validates its body, checks its permission and calls the inventory material service. The service validates referenced category/project or supplier data, writes through Prisma and records an audit event. Material project/category rules are largely enforced in application logic; database relations enforce the project reference where defined.

### Issue, transfer or adjust stock

The route validates payload and permission, then InventoryService opens a Prisma transaction, checks active material/location and relevant domain rules, reads the current derived balance, writes signed ledger entries, recomputes inventory_balances, and writes audit/event data. A transfer writes paired out/in ledger legs. The transaction makes each request atomic, but the balance read/check and writes are not serialized against another normal movement on the same stock key; see 02 and 07.

### Associate project material

Material schema includes category and optional projectNumber. The service enforces that project materials refer to an open project and that other categories do not carry that project association. Transactions also carry optional projectNumber, with a database relation. The exact category transition rules and whether historical inventory may be reclassified are encoded in service checks and require regression coverage on any change.

### Retrieve reporting data

Reporting routes validate filters and require report permission. The service aggregates transaction/balance rows and joins related material, location, supplier and project information. Some report paths issue multiple reads in parallel rather than from a single snapshot transaction, so cross-query consistency during concurrent posting is not guaranteed by the inspected service flow.

### Unauthorized request and database failure

Authentication verifies the HS256 JWT and fetches the user and current permissions. Missing/invalid tokens are rejected by the authenticate prehandler. A database failure during current-user lookup is surfaced as a server error rather than being converted to an authentication denial. Error handling returns a common error object and hides unexpected internal details.

## Confirmed and disproved assumptions

- Confirmed: React, TypeScript, Vite, Tailwind, PostgreSQL and Prisma.
- Replaced: Express is Fastify in the current source.
- Replaced: Supabase is not used by the examined application paths; Prisma connects to PostgreSQL directly.
- Not verified as a dependency: shadcn/ui; Radix UI primitives are present.
- Inventory is a central operational domain, but procurement modules also exist and are enabled by default unless disabled.
- No external queue, scheduled job runner or background worker was identified in the inspected runtime wiring. Events are dispatched synchronously in process; no durable outbox was found.
- CI exists for backend/frontend quality and backend PostgreSQL integration tests. No deployment pipeline or target infrastructure was identified.

## Phase 1 exit

Frontend, API, persistence boundaries and representative data paths are mapped from source. The architecture map is adequate for the audit; unresolved deployment topology and actual production configuration are recorded as evidence gaps.
