# Design System

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

There is no separate design-system package or document; the system lives in
the frontend code:

- **Tokens:** colours are CSS custom properties (`--color-brand-*`,
  surface scale, semantic tones) defined in `src/index.css` for light and
  dark themes and exposed to Tailwind in `tailwind.config.js`. Dark mode is
  class-based (`darkMode: 'class'`); the default theme and table density come
  from the `appearance.theme` and `appearance.density` settings.
- **Components:** shared React components in `src/components/` (Button,
  Field, Modal, ConfirmDialog, DataTable, SearchSelect, Badge,
  StockStatusBadge, Toast, Alert, KPI cards, PageHeader, AppShell, Sidebar)
  and SVG charts in `src/components/charts/`. `src/components/ui/` wraps
  Radix UI primitives (dropdown menu, popover, tooltip, scroll area) with
  `class-variance-authority`, `clsx` and `tailwind-merge`.
- **Icons:** inline SVG set in `src/components/Icon.tsx`.

The earlier pointer to a "frontend-design skill" referred to nothing in the
repository and has been removed.

## Evidence
- `afrinov-platform/apps/frontend/tailwind.config.js:7-19`
- `afrinov-platform/apps/frontend/src/index.css:22,82`
- `afrinov-platform/apps/frontend/src/components/`, `afrinov-platform/apps/frontend/src/components/ui/`
- `afrinov-platform/apps/frontend/package.json` — Radix, class-variance-authority, clsx, tailwind-merge
- `afrinov-platform/apps/backend/src/modules/settings/settings.service.ts:188-189` — appearance settings
