# Accessibility

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

| Requirement | Evidence in code | Status |
|---|---|---|
| All interactive controls keyboard-navigable and screen-reader labelled, since shop-floor terminals may be shared/kiosk-style devices | `aria-*` attributes in 54 source files; modals and the mobile drawer close on Escape; no skip-to-content link | Partial; *Unverified* — no automated accessibility test or audit exists |
| Sufficient colour contrast and non-colour status indicators (a low-stock flag should not rely on colour alone) | Stock status badges show the word (URGENT, WARNING, OK); light and dark themes from CSS variables | Labels present; contrast *Unverified* |
| Form validation errors announced, not just shown visually | Field errors render with `role="alert"`; alerts use `role="alert"`/`role="status"`; toasts use `aria-live="polite"` | Met for shared form fields and alerts |
| Reduced motion | `prefers-reduced-motion` respected in CSS and the app shell | Met |

## Evidence
- `afrinov-platform/apps/frontend/src/components/Field.tsx:24`
- `afrinov-platform/apps/frontend/src/components/Alert.tsx:23`
- `afrinov-platform/apps/frontend/src/components/Toast.tsx:49`
- `afrinov-platform/apps/frontend/src/components/Modal.tsx:23,65`
- `afrinov-platform/apps/frontend/src/components/StockStatusBadge.tsx`
- `afrinov-platform/apps/frontend/src/index.css:178`, `afrinov-platform/apps/frontend/src/hooks/useAppShell.tsx:71`
