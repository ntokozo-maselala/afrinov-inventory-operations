# AGENTS.md

Persistent notes for anyone (human or AI) working in this repository. Keep it
current: where this file and the code disagree, trust the code and update this
file.

## Layout

- `afrinov-platform/` — npm workspaces monorepo. **All installs and scripts run
  from here**, not from the repository root. `packages/` is declared in
  `workspaces` but does not exist yet.
  - `apps/backend/` — Fastify 5 REST API, Prisma 7, PostgreSQL 16, Zod, Vitest.
  - `apps/frontend/` — React SPA (Vite, Tailwind CSS 4), Vitest and Playwright.
- `.github/workflows/` — CI: `backend-ci.yml`, `frontend-ci.yml`, `codeql.yml`.
- `afrinov-docs/docs/` — the specification set.
- `docs/README.md` — documentation index. `task_context.md` — orientation.

## Runtime and toolchain

- **Node 24** is the supported runtime (local, CI, and the backend Docker image
  all use it). There is no `.nvmrc` or `engines` field; the pin lives in
  `.github/workflows/*.yml` and `apps/backend/Dockerfile`.
- TypeScript 6, ESLint 9 (flat config), Vitest 5.

## Install and verify

```sh
cd afrinov-platform
npm ci                 # install from the workspace-root lockfile

npm run typecheck      # both workspaces
npm run lint           # both workspaces
npm test               # both workspaces (backend 1142, frontend 1372)
npm run build          # both workspaces
```

Counts are a guide, not a contract; they move with every feature. Run
`npm test` and read the totals rather than trusting the numbers here.

To check that balances and issued stock add up in a database, run
`npm run check:issued-stock --workspace=@afrinov/backend` (read-only).
To see how a database's units of measure map onto the list, and which counted
items hold part of a unit, run `npm run check:units --workspace=@afrinov/backend`
(read-only; works before and after the units migration).
To see how Materials adds up against Stock and Tools, run
`npm run check:catalogue --workspace=@afrinov/backend` (read-only).
To confirm each item's active flag agrees with its status record, and list
inactive items still holding stock, run
`npm run check:item-status --workspace=@afrinov/backend` (read-only).
To see how slips were confirmed by the people collecting them, and which still
wait, run `npm run check:receipts --workspace=@afrinov/backend` (read-only).

Integration tests need a real Postgres and a throwaway database. See
`apps/backend/README.md` ("Running it locally") and `.github/workflows/backend-ci.yml`
for the exact environment (`DATABASE_URL`, `JWT_SECRET`, `SEED_ADMIN_PASSWORD`),
then `npm run test:integration --workspace=@afrinov/backend`.

## Engineering assurance

`docs/engineering/` documents how this repository is verified and released:
quality gates, security controls, database assurance, CI/CD architecture, the
risk register and the exceptions register. Read `docs/engineering/README.md`
before changing CI, migrations, authentication or authorization. Two rules from
there matter day to day:

- **Do not add a `gitleaks` allowlist entry for a real secret.** The repository
  is public. Rotate first, then record it in `docs/engineering/EXCEPTIONS.md`.
- **A migration that matches `schema.prisma` is enforced by CI.** A change to
  `prisma/schema.prisma` without a matching migration fails the `migration-drift`
  job in `backend-ci.yml`. Use `npx prisma migrate diff --from-config-datasource
  --to-schema prisma/schema.prisma --script --exit-code` locally to check.

## Dependency upgrades

Prefer staged upgrades and keep typecheck/lint/tests/build green at each step:

1. In-range patch/minor bumps first (`npm update`, or pin explicitly).
2. Majors one at a time, committed separately.
3. Verify from a **clean `npm ci`**, not just the existing `node_modules`.

### npm 11 `allowScripts`

The root `package.json` has an `allowScripts` allowlist for packages whose
install scripts may run. The keys are **version-pinned** (`pkg@x.y.z`). When a
listed package changes version, the entry goes stale and a fresh `npm ci`
reports the script as unreviewed — for Prisma this silently skips the engine
download. After bumping a listed package, run `npm install-scripts ls` and
update the pins.

### Held back (blocked upstream, do not bump without a peer release)

- **ESLint 10** — `eslint-plugin-react@7` peers `eslint` at `^3 … ^9.7`; there
  is no ESLint 10 release of that plugin yet.
- **TypeScript 7** — `typescript-eslint@8` peers `typescript` at `>=4.8.4
  <6.1.0`. Move both together once typescript-eslint supports TS 7.
- **Prisma 8** — only `8.0.0-rc.*` prereleases exist; stay on 7.x.
- **`@types/node`** — track the Node major (currently `^24`), not npm `latest`
  (`26.x`), so types match the runtime.

Re-check these with `npm outdated --workspaces --long` before assuming they are
still blocked.

### API conventions introduced by the current majors

Use these forms; the older spellings still work but are deprecated or removed.

- **Zod 4** — use the top-level validators, not the string-method forms:
  `z.email()`, `z.uuid()`, `z.iso.datetime()` (was `z.string().email()`,
  `z.string().uuid()`, `z.string().datetime()`). They chain the same
  (`.optional()`, `.nullable()`, `.max()`). `.openapi({…})` still comes from
  `extendZodWithOpenApi`.
- **React 19** — components take `ref` as a normal prop. Declare `ref?: Ref<T>`
  on the props interface instead of wrapping in `forwardRef`; do not
  `import * as React`.
- **Vitest 5** — `singleFork` is gone; use `fileParallelism: false` (plus
  `isolate: false` where a shared real-database state must persist).
- **Vite 8** — config imports of local TypeScript modules need the explicit
  `.ts` extension.

## Notes

- **Error handling has one entry point per side.** The backend answers every
  non-2xx through `toErrorEnvelope` (`src/shared/errors.ts`) — do not hand-build
  an error body. The frontend decides what a user reads in
  `src/lib/errorPresentation.ts`; `api/client.ts` also substitutes its own copy
  for any non-domain server message at the boundary, so a screen that renders
  `err.message` cannot leak server text. Never render a raw exception message.
  See `afrinov-docs/docs/12-operations/error-handling.md` and
  `afrinov-docs/docs/08-api/error-model.md`.
- **A failed refresh keeps data only for availability failures.** `useApi`
  marks `stale` for `SERVICE_UNAVAILABLE`/`NETWORK_ERROR`/`TIMEOUT`; `FORBIDDEN`
  and `UNAUTHENTICATED` clear it, so a permission loss is never shown as "here
  is the old copy". `usePagedList` forwards `stale`, and one stale source must
  not mask a hard failure in another required list on the same page.
- **Never auto-retry a mutation.** A timed-out or dropped write is
  `OUTCOME_UNKNOWN` (check the record, then retry), not a retryable read
  timeout. Error toasts are capped at three so an outage cannot fill the
  screen.
- **Inventory mutations are retry-safe through an idempotency key.** The
  frontend mints one `Idempotency-Key` per logical submission
  (`src/lib/idempotency.ts`) and reuses it across retries; the backend stores
  it in `idempotency_keys` inside the same transaction as the movement
  (`src/shared/idempotency.ts`), so a retry replays the first response instead
  of posting twice. The key is scoped by actor, route *and* concrete path, so
  the same key on a different record is a `CONFLICT`, not a replay. Wire new
  mutation forms through `useIdempotencyKey` and rotate the key only after a
  confirmed success — never after an `OUTCOME_UNKNOWN` failure.
- **Quantities follow the item's unit.** Units live in `units_of_measure`;
  a COUNTED unit (each, pair, box) takes whole numbers, a MEASURED one (m, kg, l)
  up to 4 decimals. Every service that takes a quantity a person typed calls
  `checkWholeUnits` (`src/shared/units.ts`) inside the transaction that
  writes; figures the system works out are not checked again. Where something
  is left to close off (owed on an order line, out on an issue or a tool loan),
  pass it as the `remainder`, with the lines taking from it in one `group`
  (`fitsRemainder`): each is whole, except one may carry exactly the
  remainder's part-unit, so stock booked in part-units before the rule can be
  finished and none is started. `checkWholeUnits` holds the items' rows
  `FOR SHARE`, and a change to a counted unit takes them `FOR UPDATE`, so the
  two can't interleave. On the frontend, use `QuantityInput` and
  `parseQuantity` (`src/lib/quantity.ts`, with the same `remainder` option),
  never `type="number"`, for a stock quantity. A new spelling of a unit goes in
  `UNIT_ALIASES`.
- **Materials counts items; Stock counts lines.** A line is an item at a location,
  so an item in two places is two lines, and an item never received has none.
  Tools lists active tools only. Don't add these totals together, and don't count
  items on a page: `catalogueTabOf`, `stockStateOf` and `summarise`
  (`src/modules/inventory/catalogue.service.ts`) are the one definition, read by
  `GET /materials/summary` and `check:catalogue` (ADR-031). The Tools tab is a
  view: `sectionOf` still puts tools in Stores for orders and stock rules.
- **Inactive means nothing moves.** An item's status changes only on
  `PATCH /materials/:id/status`, with a reason, and is a row of its own on
  Movements with no quantity, never a ledger line. It is deactivated only when
  clear, with no override: no stock, no tool on loan, no adjustment waiting, no
  order still owing. A new path that moves stock calls `checkMaterialActive`
  after its balance lock: it holds the item's row, so a deactivation waits for
  the movement or the movement is refused (ADR-033).
- **An adjustment's reason sets its sign.** Damage, loss and scrap only remove
  stock, Found only adds it, Other goes either way; Found and Other need a note
  (`checkRequestedAdjustment`). The API still takes the signed quantity.
- **One adjustment of a stock waits at a time.** A manual adjustment, like a
  stock count, takes the balance lock and is refused while any adjustment of
  that material, location and project stock is waiting for approval; approving
  both would correct the same difference twice.
- **A slip posts first; the person collecting confirms it beside the ledger.**
  An issue or tool loan slip (one `issueId`) is confirmed in
  `receipt_confirmations` by counter PIN, signature or a photo of the signed
  slip, or the reason it wasn't is kept; it never moves stock (ADR-034). A
  worker or contractor confirms only their own slip; a machine or site's is
  confirmed by whoever collected. Return recipients through `publicRecipient`
  (`src/modules/operations/recipient-pin.ts`), never the raw row, so
  `pin_hash` never leaves the server, and check a PIN with `verifyPin`, outside
  the confirmation's transaction, so a wrong try is counted. On the frontend,
  open `HandoverPanel` after a slip posts; it keys the retry by a payload
  without the PIN or image, so neither is kept in the browser.
- `pino-pretty` is loaded by name as a Fastify transport target
  (`src/server.ts`), so it looks unused to static analysers but is required.
- Tailwind CSS 4 is configured in CSS (`src/index.css`), not a JS config. See
  the comment above the `@theme inline` block before editing colour tokens.
