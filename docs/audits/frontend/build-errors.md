# Frontend production build failure analysis

**Date:** 2026-10-08, revised 2026-10-29.
**Scope:** Diagnosis and remediation of the Tailwind/PostCSS build failure.

## Finding

The build stops while Vite processes `apps/frontend/src/index.css`:

```
[plugin:vite:css] [postcss] postcss-import: .../node_modules/tailwindcss/lib/index.js:1:1: Unknown word "use strict"
```

The cause is a **version mismatch**: a Tailwind **v3** PostCSS setup run against
Tailwind **v4**. Tailwind v4 moved the PostCSS plugin into a separate package,
`@tailwindcss/postcss`, and its `tailwindcss` package no longer exposes a
`lib/index.js` CommonJS entry. When PostCSS is pointed at the v4 `tailwindcss`
package (v3-style `postcss.config.js`) it loads that package's JavaScript as
CSS, which is where `Unknown word "use strict"` comes from. The reported
`index.css:undefined:NaN` location is a consequence of that plugin error, not
evidence of a malformed CSS line.

## Historical remediation (superseded)

The 2026-10-08 pass resolved the error by restoring Tailwind `^3.4.6` and
keeping the v3-style `@tailwind` directives and PostCSS config. That left the
tree on v3 and predates the v4 migration.

## Current state (2026-10-29)

The repository has since migrated to Tailwind v4 (`chore(deps): migrate Tailwind
CSS to 4`). The configuration and CSS now agree on v4, and the error does not
reproduce:

- `apps/frontend/package.json` declares `tailwindcss` and `@tailwindcss/postcss`
  at `^4.3.3`; the platform lockfile resolves both to `4.3.3`.
- `apps/frontend/postcss.config.js` registers `{ '@tailwindcss/postcss': {} }`.
- `apps/frontend/src/index.css` uses `@import 'tailwindcss'` and
  `@plugin 'tailwindcss-animate'`, not the v3 `@tailwind` directives.
- There is no workspace-local Tailwind install; the platform lockfile is the
  single source of the version.

Reproduction check: temporarily restoring the v3-style config
(`plugins: { tailwindcss: {} }`) against the v4 tree fails with

```
[postcss] It looks like you're trying to use `tailwindcss` directly as a
PostCSS plugin. The PostCSS plugin has moved to a separate package ...
```

which confirms the diagnosis above. The committed v4 config builds cleanly.

## Build stage

The frontend build script is `tsc -b && vite build`. The failure occurs in the
Vite CSS/PostCSS stage, after TypeScript has compiled successfully.

## Remediation applied (current)

- `postcss.config.js` uses the v4 plugin, `@tailwindcss/postcss`.
- `index.css` uses the v4 `@import 'tailwindcss'` form.
- No CSS import was removed and no styling was changed to hide an error.

## Verification

`npm run build --workspace=@afrinov/frontend` succeeds: TypeScript compilation
passes, Vite transforms the frontend and emits the production bundle. The
development server serves `/src/index.css` with no PostCSS error. The build now
reports zero warnings (the earlier plugin-config deprecation, ExcelJS `eval` and
chunk-size warnings are gone). `npm audit` reports 0 vulnerabilities on the
current tree.

## Relationship to other records

This file is the historical, focused analysis. The superseding re-verification
(F-02, F-08, F-09) and the Qodo review round are recorded in
`docs/audits/system/FAILURE_REGISTER.md`; the runtime error-handling behaviour
and its test coverage are in
`afrinov-docs/docs/12-operations/error-handling.md`.
