# Theme default and application audit

## Audit findings

- The frontend had several independent `system` defaults: the shared appearance cache, the older local preferences module, the backend settings catalog, and the mock settings catalog. With the OS set to dark, these defaults activated Tailwind's `.dark` class.
- `index.html` did not initialize a saved theme before React mounted, so a returning user could first see the light CSS defaults and then switch to dark.
- Theme application was duplicated in the appearance cache, settings provider, and preferences applier. The applier was also mounted in both the protected route and app shell, issuing duplicate preference reads.
- The app already had a useful token foundation: Tailwind maps color utilities to CSS variables in `src/index.css`; the dashboard's custom CSS and charts mostly use those variables. The dashboard health legend referenced undefined `success-300`, `warning-300`, and `danger-300` text colors.
- Several dark status foreground tokens were too dim for their dark status surfaces. Light `surface-400` also had insufficient contrast for text. A few logo and selected-brand surfaces used pale backgrounds without dark variants.

## Implementation and design decisions

- `apps/frontend/index.html` applies the stored browser theme synchronously before the page paints. With no saved choice, it always applies Light and ignores the OS preference.
- `src/hooks/useAppearance.ts` is the single browser theme cache and apply path. It stores the selected choice in `afrinov.appearance.theme.v1`, reads the old `afrinov.settings.v1` value for compatibility, sets the root `.dark` class and `color-scheme`, and safely falls back to Light if storage is unavailable or invalid.
- Settings offers Light, Dark, and System. A selection takes effect immediately and is persisted in browser storage. System follows OS changes on every route. The server setting remains the default when the browser has no choice; explicit local choices take precedence.
- The backend catalog and mock catalog now default to Light. Startup only converts a legacy `system` database value when it has no recorded updater; explicitly saved Dark and System values are preserved.
- The protected shell waits for its existing preference read before showing page content. The HTML bootstrap covers login and other unauthenticated screens from browser storage.
- Existing token mappings remain in place: app backgrounds use `surface-50`, cards use `surface-0`, elevated/muted areas use the surface scale, text uses surface shades, borders use surface-200/300, statuses use success/warning/danger/info, charts use the chart palette and surface grid tokens, and Afrinov red remains the brand accent.
- Dark `surface-400` and status 600/700 values were brightened for readable secondary text and status labels. The dashboard legend now uses defined 700 tokens; brand logos, selected roles, badges, and progress states use dark surfaces.

## Verification

- Frontend unit suite: **65 files passed, 667 tests passed**.
- A first full-suite run overlapped with lint, build, and typecheck and timed out one unrelated purchase-order test; the isolated full-suite rerun passed all 667 tests.
- Backend settings service suite: **1 file passed, 32 tests passed**.
- Frontend lint, frontend typecheck, backend typecheck, and frontend production build all passed.
- The production build reports existing Vite configuration and optimizer deprecation warnings, a direct `eval` warning from ExcelJS, and a large ExcelJS chunk warning.
- Representative contrast ratios were calculated from the configured sRGB token pairs: primary text on the light app background 14.31:1; light `surface-400` muted text 4.86:1; light success/warning/danger text on status surfaces 8.37:1, 6.75:1, and 9.17:1; dark primary text on cards 14.01:1; dark `surface-400` muted text 4.83:1; dark success/warning/danger/info text on status surfaces 10.96:1, 12.89:1, 9.26:1, and 9.07:1. The brand focus outline is 4.62:1 on the light app background and 3.44:1 on the dark app surface.

## Outstanding verification and intentional colors

- No browser screenshot comparison or manual screen-reader session was run. The repository has a Playwright login suite that starts the real backend and database; it was not run because it exercises a live database, while the frontend unit suite and focused theme component tests passed.
- Dashboard chart series and gradient colors remain fixed data-visualization colors; logo artwork and PDF export colors remain fixed brand artwork. They are not used as application surface or body text colors.
- An existing server-only Dark choice is applied after sign-in if a browser has not yet cached it. The protected shell is held until that preference read finishes; the unauthenticated login view uses Light until a browser choice is available.
