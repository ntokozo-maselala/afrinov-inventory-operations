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
npm test               # both workspaces (backend 1366, frontend 1615)
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

### Security overrides

`overrides` in the root `package.json` patch transitive dependencies that an
upstream release still pins. Fix an audit finding with a scoped, exact-version
override or an in-range bump, never `npm audit fix --force` (it proposed
downgrading Prisma to 6.x). After changing an override, run `npm update <pkg>`
so the lockfile picks it up, then verify from a clean `npm ci`.

- **`@prisma/config` → `effect` 3.22.4** — GHSA-7589-6fvf-x4pw (ReDoS, high);
  prisma 7.10.1 pins `effect` 3.20.0. Remove once a prisma release depends on
  `effect` ≥ 3.22.1 (`npm view @prisma/config@latest dependencies.effect`).

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
- **Read a query parameter through a check before it reaches Prisma.** A list
  route that reads `?limit` by hand uses `pageLimit(raw, max)`
  (`src/shared/paging.ts`), never `Number(q['limit'])`: `abc` became `take: NaN`
  (a 500) and `-1` the oldest rows. An enum filter is checked against its list
  first (as `GET /settings?category` is against `SETTING_SECTIONS`).
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
  confirmed success — never after an `OUTCOME_UNKNOWN` failure. Creating a
  supplier, purchase order or RFQ takes a key too (ADR-042): a create service
  called from `idempotentMutation` takes the transaction it is given.
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
- **Stock never goes below zero: lock, then read (ADR-047).** A path that moves
  stock takes `lockInventoryBalances` for every balance it touches *before*
  reading any of them, then checks, writes the ledger line and calls
  `recomputeBalance`; a reading taken before the lock is stale and passes a
  check it shouldn't. `inventory_balances` has a `CHECK (quantity >= 0)`
  behind it, answered as 422 `INSUFFICIENT_BALANCE` and logged as
  `stock-floor-refused`, a defect. A new file that writes the ledger with a
  direct Prisma call or raw SQL fails `ledger-writers.test.ts` until it is
  added there. That guard works file by file, so a new path in a file already
  listed passes it whether or not it locks: follow the order by hand and give
  it a race in
  `integration/stock-floor-races.real-http.test.ts` with `overlapping`
  (`integration/helpers.ts`), not a bare `Promise.all`. A migration's
  rollback goes in `prisma/rollbacks/` and is tested inside an undone
  transaction. The CHECK can't see a balance that differs from its ledger,
  so the backend reconciles once a day (`stock-reconciliation.ts`, records in
  `stock_reconciliation_runs`, logs `ledger-drift`, Dashboard card for
  Admins); an integration suite that leaves figures not adding up fails
  `stock-reconciliation.real-http.test.ts`.
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
- **Locations and projects close only when clear (ADR-038).** A location is
  deactivated only with no stock, no tool out from it, no adjustment waiting
  and not where project deliveries go; a project is completed or cancelled
  only with no open order, open RFQ, tool on loan or waiting write-off.
  `checkLocationActive` holds the location's row `FOR SHARE` and
  `checkProjectTakesIssues` the project's; a new path that moves stock onto a
  location, or works for a project, uses them so a close can't slip past it.
  A project's status decides `active` (Completed and Cancelled are inactive),
  enforced by a database check: never set `active` on its own.
- **An adjustment's reason sets its sign.** Damage, loss and scrap only remove
  stock, Found only adds it, Other goes either way; Found and Other need a note
  (`checkRequestedAdjustment`). The API still takes the signed quantity.
- **One adjustment of a stock waits at a time.** A manual adjustment, like a
  stock count, takes the balance lock and is refused while any adjustment of
  that material, location and project stock is waiting for approval; approving
  both would correct the same difference twice.
- **An adjustment sent back for changes is still open (ADR-044).** An approver
  approves, rejects or sends a waiting adjustment back
  (`CHANGES_REQUESTED`); whoever asked amends it and sends it again
  (`WriteOffApprovalService.resubmit`), and it always waits for approval again.
  A check for a waiting adjustment uses `OPEN_ADJUSTMENT_STATUSES`
  (`write-off-requests.ts`), never `PENDING` alone, and every step of a
  request goes through `recordRequestEvent`, which keeps the request as it
  stood: the rows of `adjustment_request_events` are only added. Whoever
  asked withdraws their own (`WITHDRAWN`); `REJECTED` is only someone else's
  decision, so never show a withdrawal as a rejection.
- **A tool's write-off is an adjustment request like any other (ADR-045).**
  Lost on loan (`ToolLoan`) or held for repair (`ToolRepair`), it goes
  through the same steps; what may change when it is sent back is
  `amendableOf` (a lost tool's quantity is checked by
  `ToolLoanService.checkLostAmendment`). Approving writes `APPROVED` then
  `COMPLETED` with the posted movement; read history ordered by `at`, then
  `seq`, as steps of one transaction share a time.
- **A slip posts first; the person collecting confirms it beside the ledger.**
  An issue or tool loan slip (one `issueId`) is confirmed in
  `receipt_confirmations` by counter PIN, signature or a photo of the signed
  slip, or the reason it wasn't is kept; it never moves stock (ADR-034). A
  worker or contractor confirms only their own slip; a machine or site's is
  confirmed by whoever collected, and someone who has left only by a paper
  slip signed at the time. A slip with every line reversed can't be confirmed.
  Return recipients through `publicRecipient`
  (`src/modules/operations/recipient-pin.ts`), never the raw row, so
  `pin_hash` never leaves the server, and check a PIN with `verifyPin`, outside
  the confirmation's transaction, so a wrong try is counted. On the frontend,
  open `HandoverPanel` after a slip posts; it keys the retry by a payload
  without the PIN or image, so neither is kept in the browser.
- **Project material leaves the store on the Workshop Manager's approval
  (ADR-043).** `InventoryService.issue` refuses a project unless
  `IssueRequestService.approve` passes `approvedRequestId`; the counter asks
  through `POST /issue-requests`, and only the Workshop Manager, or the
  Director standing in, approves (Admin only by holding one of those roles).
  The approval writes the slip's `APPROVAL` receipt confirmation, so a project
  slip asks no PIN. A project issue takes only stock held for it, and Stores
  stock never goes to a project (`checkIssueStock`); a Projects item's Stores
  stock is a leftover, moved to Stores before it is issued
  (`refuseProjectsItemFromStores`). In integration tests issue to a project
  with `issueToProject` and `workshopManager` (`integration/helpers.ts`).
- **A setting on the page has an effect.** Add a key to `SETTING_CATALOG` only
  with the code that reads it; one nothing reads is retired with a migration
  that deletes its row (ADR-035). A changed description needs a migration too:
  Settings shows the row's description and the seed never rewrites a row.
- **A sign-in ends after the idle time, and after 12 hours.** Tokens last
  `security.sessionTimeoutMinutes` and carry `auth_time`; issue them only
  through `issueSessionToken` (`src/modules/identity/session.ts`), never
  `app.jwt.sign` in a route. The `authenticate` hook refuses a token older than
  the idle time in force now. On the frontend `SessionKeeper` renews through
  `POST /auth/refresh` only after the person's own input (pointer, key, wheel,
  touch), never because a request was made, so a page that polls still signs
  out when left alone (ADR-035). Signing out ends the sign-in on the server:
  `POST /auth/logout` sets `users.signed_out_before` and the hook refuses an
  older sign-in, as for a password change (ADR-042).
- **A password change ends every other sign-in; someone always holds Admin.**
  A sign-in that began before `users.password_changed_at` is refused, and while
  `must_change_password` is set (an Admin's temporary password) only
  `/auth/me`, `/auth/refresh`, `/auth/password` and `/auth/logout` answer. Any path that sets a
  password sets `passwordChangedAt` too. A user sent to a client selects
  `USER_FIELDS` (`src/modules/identity/identity.service.ts`), never the whole
  row, so `passwordHash` never leaves the server (AUD-006, TD-028).
  `UserService.update` refuses a change that leaves no active Admin, or that
  brings two or more down to one
  (`MIN_ADMINS`, kept in step with `src/lib/admins.ts`), under the
  `afrinov:admins` lock (ADR-036).
- **Controls (ADR-039).** Only `edit:unit_cost` (Admin, Procurement) sets an
  item's unit cost, a change needs `unitCostReason`, and each is a row of
  `material_cost_changes`. A write-off is judged with the same person's
  write-offs of the item over 7 days (`recentWriteOffQuantity`): pass it to
  `writeOffRule` on any new path that writes stock off. Changing an approved
  order's `SIGNED_TERMS` sends it back for signing. Closing a project, or
  changing its manager, takes `close:project` or being its manager
  (`CloseRights`, required: never default it to true). Switching off either
  `TWO_PERSON_SETTINGS` needs a reason; "Reset to defaults" resets one
  section. Sign-ins go on `sign_in_events` (`recordSignIn`), kept 12 months.
  `POST /purchase-orders/:id/receive` and `POST /stock-items` are retired: in
  integration tests receive with `receiveOutstanding` (`integration/helpers.ts`).
- **Putting stock right (ADR-040).** Goods going back to a supplier are a
  `RETURN_TO_SUPPLIER` against a receipt line, never a loss; a receipt line
  against an order is reversed with its order. Both lower the order line's
  received quantity through `lowerReceived` (`src/shared/inventory/receipt-corrections.ts`),
  after holding the order and its line (`lockOrderLine`) and before the stock,
  as receiving does. A posted receipt line keeps its movement in
  `transaction_id`. A tool checked in damaged is held for repair
  (`tool_repairs`): a new path that lends or moves a tool reads `heldAt`, and a
  transfer moves the hold (`moveHeld`). Counts are of one stock (Stores or a
  project's), FULL or SPOT, from a sheet with an `openedAt`; a moved line is
  held back, not the whole count.
- **Days are South African (ADR-041).** A day or month a person picks, or a
  report's default period, is UTC+2 all year: use `saDayStart`, `saDayOf`,
  `saToday`, `saMonth` and `saMonthRange` (`src/shared/dates.ts`), never
  `toISOString().slice(0, 10)` of a time or `T00:00:00Z`; on the frontend,
  `today()` and `saDay()` (`src/lib/dates.ts`).
- **A closed month keeps its figures (ADR-041).** An Admin closes a month
  that is over (`MonthCloseService`): its stock report is kept with every
  unit cost then, and the month's report and stock used in it read those.
  Reopening needs a reason. A new report that values a past period at unit
  cost reads `MonthCloseService.pricesFor` for closed months.
- **Every document carries the Afrinov header; the tool writes it.** Logo,
  document ID, title over type, last updated and by whom, between
  `afrinov:document-control` comments at the top of each controlled Markdown
  file. After adding, changing, moving or removing a document, run
  `npm run docs:stamp` (from `afrinov-platform/`) and commit what it writes;
  `docs-ci.yml` fails otherwise. Never edit the header by hand, and never
  reuse an ID. Scope, IDs (interim `AFRI-OMS-…`) and people are in
  `docs/document-control/register.json`; the standard is
  `docs/document-control/STYLE_GUIDE.md`. This file is outside the scope.
- **The seed loads demo data only with `SEED_DEMO_DATA=true`, never in
  production** (`src/db/seed-plan.ts`). Reference data (permissions, roles,
  settings, the admin) goes before the `if (!plan.demo)` return in
  `seed.ts`; anything a demo needs goes after it. `db:test:seed` and CI ask for
  demo data.
- **Backups are a service, not a habit** (ADR-037). `apps/backend/backup`
  (POSIX shell, LF endings via `.gitattributes`) backs up, encrypts, copies off
  site and records each run in `backup_runs`, which the app only reads
  (`GET /backups/status`). A new table is in every backup automatically; if a
  migration changes the table count a lot, check `BACKUP_MIN_TABLES`. CI runs a
  backup and restore test after the integration tests.
- **Production runs both Compose files.** `apps/backend/docker-compose.prod.yml`
  binds the database and API to `127.0.0.1` only; the server's
  `apps/backend/.env` sets `COMPOSE_FILE` to include it. The step-by-step guide
  is `afrinov-docs/docs/12-operations/deployment.md`: keep it in step with any
  change to the stack, its settings or the go-live steps.
- **Behind a proxy, `TRUST_PROXY` names it** (addresses only; `true` and hop
  counts are refused), or every person counts as the proxy's address for the
  sign-in limit (`afrinov-docs/docs/12-operations/reverse-proxy.md`).
- `pino-pretty` is loaded by name as a Fastify transport target
  (`src/server.ts`), so it looks unused to static analysers but is required.
- **Icons come from two SVGs.** `public/favicon.svg` is the tab icon (16 and
  32 px, no veins) and `src/assets/icon/afrinov-mark.svg` the full mark; after
  editing either, run `npm run icons --workspace=@afrinov/frontend` and commit
  the PNGs and `favicon.ico` it writes. `src/icons.test.ts` checks the links,
  sizes and that both SVGs parse (an XML comment can't hold a double hyphen).
- Tailwind CSS 4 is configured in CSS (`src/index.css`), not a JS config. See
  the comment above the `@theme inline` block before editing colour tokens.
