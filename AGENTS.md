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
npm test               # both workspaces (backend 874, frontend 905)
npm run build          # both workspaces
```

Counts are a guide, not a contract; they move with every feature. Run
`npm test` and read the totals rather than trusting the numbers here.

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
- `pino-pretty` is loaded by name as a Fastify transport target
  (`src/server.ts`), so it looks unused to static analysers but is required.
- Tailwind CSS 4 is configured in CSS (`src/index.css`), not a JS config. See
  the comment above the `@theme inline` block before editing colour tokens.
