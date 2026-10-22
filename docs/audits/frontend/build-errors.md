# Frontend production build failure analysis

**Date:** 2026-10-08  
**Scope:** Diagnosis and remediation of the Tailwind/PostCSS build failure.

## Finding

The build stops while Vite processes `apps/frontend/src/index.css` because Tailwind CSS v4 is configured using the Tailwind v3 PostCSS plugin entry point.

Evidence in the frontend workspace:

- `apps/frontend/package.json` declares `tailwindcss` as `^4.3.3`.
- The lockfile resolves `tailwindcss` to `4.3.3`.
- `apps/frontend/postcss.config.js` registers `{ tailwindcss: {}, autoprefixer: {} }`.
- `apps/frontend/src/index.css` begins with the older `@tailwind base`, `@tailwind components`, and `@tailwind utilities` directives.
- The build output explicitly says Tailwind cannot be used directly as a PostCSS plugin and that the PostCSS integration moved to `@tailwindcss/postcss`.

These versions and configuration did not agree. Tailwind v4 separates the PostCSS plugin from the `tailwindcss` package. When PostCSS loads `tailwindcss` directly, it throws before Vite can finish CSS processing. The reported `index.css:undefined:NaN` location was a consequence of the PostCSS plugin error, not evidence of a malformed CSS line at that location.

## Build stage

The frontend build script is `tsc -b && vite build`. Since the log reaches Vite's production build and reports a CSS plugin error, the TypeScript build completed successfully; the failure is in the later Vite CSS/PostCSS stage.

## Other messages

The `esbuild` and `optimizeDeps.esbuildOptions` notices are deprecation warnings emitted by the React Vite plugin. They are not the fatal error in this run. They indicate that the plugin is setting options that Vite 8 is migrating toward Oxc and Rolldown equivalents; the log shows CSS processing is what actually aborts the build.

## Remediation applied

- Restored the frontend's Tailwind dependency to `^3.4.6`, matching the existing v3-style directives, PostCSS configuration, JavaScript config, theme extensions, and `tailwindcss-animate` plugin.
- Updated the root lockfile through npm so the installed dependency and lockfile state match the manifest. The lockfile now resolves the compatible Tailwind v3 line.
- No CSS, PostCSS, or Tailwind config rewrite was needed.

## Verification and remaining warnings

`npm run build --workspace=@afrinov/frontend` now completes successfully: TypeScript compilation passes, Vite transforms the frontend, and the production bundle is emitted.

The React plugin's Vite `esbuild` / `optimizeDeps.esbuildOptions` deprecation warnings remain nonfatal. The build also reports an existing large ExcelJS chunk and a direct `eval` warning from ExcelJS. None of these warnings stopped this production build.

The build command reported 7 npm audit findings (2 moderate, 5 high) during dependency installation. They were not automatically changed as part of this focused build fix.
