# Frontend-only development mode

*Last verified against code: 4e6d76f, 2026-10-09.*

Use this mode when you want to **inspect the UI without running the backend or
database**. The frontend starts up, authenticates as a development user, and
serves all data from an in-memory mock store.

The backend, database, migrations, Docker, and Prisma are **not touched** and
are not required to be running.

---

## When to use it

- Walking through the UI before the backend is fully wired up.
- Reviewing the design/UX in isolation.
- Demos where the audience only needs to see the frontend.
- Working offline (no Postgres / Docker available).

## How to enable

The mode is controlled by the `VITE_FRONTEND_ONLY` env var, set when the Vite
dev server starts.

```bash
# from apps/frontend (or via the root convenience script)
npm run dev:frontend-only
```

The script is defined in `apps/frontend/package.json`:

```json
"dev:frontend-only": "cross-env VITE_FRONTEND_ONLY=true vite"
```

You can also pass it inline:

```bash
VITE_FRONTEND_ONLY=true npm run dev
```

Then open <http://localhost:5173>. The amber banner at the top of every page
makes it visually obvious you are in mock mode.

> **Demo login is off by default.** `VITE_DEMO_AUTH_ENABLED` is `false`
> unless you set it, so plain `npm run dev` signs in through
> `POST /auth/login` on the real backend. Set it to `true`, with
> `VITE_DEMO_AUTH_EMAIL` and `VITE_DEMO_AUTH_PASSWORD`, to accept only that
> one demo pair.

## How to disable

Stop the dev server and start it without the flag:

```bash
# normal mode (talks to the real backend)
npm run dev
```

Make sure no `.env.local` or shell-level `VITE_FRONTEND_ONLY=true` is set —
the value is read by Vite at build/dev-server start, not per request.

## What changes

| Concern | Normal mode | Frontend-only mode |
|---|---|---|
| `api` client (`src/api/client.ts`) | Real `fetch` to `/api/v1/*` | Proxy → in-memory mock router (`src/mock/mockApi.ts`) |
| Authentication (`src/api/authService.ts`, `src/auth.tsx`) | Calls `POST /auth/login` and `GET /auth/me` against the backend | Resolves immediately to the dev user; login accepts any non-empty credentials |
| Dev banner | Hidden | Visible at the top of every page |
| Data | Backend → PostgreSQL | In-memory store; reset on full page reload |
| Mutations | Persisted to the DB | Persisted in memory for the current session only |

The real `fetch` path is preserved **verbatim** — the mock is selected by a
single conditional at module-load (`FRONTEND_ONLY ? Proxy : realApi`). When
`VITE_FRONTEND_ONLY` is unset or `"false"`, the conditional is statically
`false` and Vite's tree-shaker drops the proxy and the mock import.

## Mock data

The mock store seeds itself with realistic Afrinov examples so the UI has
something to render immediately:

- 4 suppliers (Hydroscand, Bearings International, etc.)
- 12 materials spanning all 5 categories
- 5 locations (storeroom, racks, off-site)
- 2 purchase orders in different states
- 2 projects, plus racks and recipients
- 1 posted goods receipt
- 20 ledger transactions (receipts, issues, a transfer, an adjustment)
- Reorder thresholds set so the dashboard shows a few "below threshold" items

Mutations through the UI (creating a PO, issuing stock, transferring, etc.)
update the in-memory store and the UI re-renders. **State is lost on a full
page reload** — this is intentional. There is no localStorage, so a reload
restores the seed.

## Mock-auth details

In frontend-only mode the dev user is:

```text
email:   admin@afrinov.local
name:    System Administrator (dev)
roles:   ADMIN, STORE_CONTROLLER, PROCUREMENT, APPROVER, TECHNICIAN, VIEWER
```

The name and roles are clearly marked as development so it is obvious in
demos that this is not a real user. The `Login` page accepts any non-empty
email + password combination. Entering `admin@afrinov.local` (with any
password) signs you in as the dev user above; any other email is treated as
a local user and synthesises a profile from the local part of the address.

## Production safety

- **A production build refuses to run with either demo flag on.** If
  `VITE_FRONTEND_ONLY` or `VITE_DEMO_AUTH_ENABLED` is `true`, in the shell or
  in any `.env` file, `npm run build` fails with an error naming the flag
  (`src/config/buildGuard.ts`, wired in `vite.config.ts`). The dev server is
  unaffected.
- To build a demo bundle on purpose, for example to host a clickable preview,
  run `npm run build:frontend-only`. It builds in `demo` mode, which the check
  allows.

- The flag is read from `import.meta.env.VITE_FRONTEND_ONLY`. Vite **only
  exposes variables prefixed with `VITE_` to the client bundle** and **only
  inlines them at build time** if they are set.
- The mock store code is loaded only via a dynamic `import()` that fires when
  the conditional resolves to true. The bundle is identical in shape to a
  normal build; the proxy code-path is unreachable when the flag is unset.
- The dev banner is gated on the same `FRONTEND_ONLY` constant. Setting the
  flag in production would also surface the banner — making accidental
  activation visible.
- The backend is never contacted in this mode; the `fetch` call site is
  bypassed entirely.

## Limitations

These cannot function without the real backend and intentionally are not
emulated:

- **Real authentication** — no JWT, no expiry, no per-user permission checks
  (the dev user is granted every role for UI visibility).
- **Audit log** — material/PO mutations are not recorded in any durable
  store; the in-memory store's mutation history is not browsable from the UI.
- **Concurrent users** — the mock is a single in-memory store; opening two
  browser tabs will see two independent stores.
- **Persistence across reloads** — there is no localStorage backing; full
  page reloads reset the state.
- **File uploads / document attachments** — the Documents bounded context is
  not implemented; the mock returns `NOT_FOUND` for any document-related
  route (none currently called by the UI).

## Files involved

```
apps/frontend/
├── src/
│   ├── api/client.ts              ← selects real or mock api based on flag
│   ├── api/authService.ts         ← dev-user bypass when flag is on
│   ├── components/
│   │   └── DevModeBanner.tsx      ← amber banner (only when flag is on)
│   └── mock/
│       ├── types.ts               ← mock domain types (mirror API responses)
│       ├── seed.ts                ← seed data
│       └── mockApi.ts             ← in-memory router implementing the same surface
└── .env.example                   ← documents the flag
```

## Returning to normal development

```bash
# 1. stop the dev server
# 2. make sure VITE_FRONTEND_ONLY is unset
unset VITE_FRONTEND_ONLY        # bash/zsh
Remove-Item Env:VITE_FRONTEND_ONLY   # PowerShell

# 3. start backend (and database) normally
cd apps/backend
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run dev

# 4. in a separate terminal, start the frontend normally
cd apps/frontend
npm run dev
```
