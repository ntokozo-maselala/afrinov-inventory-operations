# Navigation Model

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

A persistent sidebar (a drawer on small screens) with six groups:
Overview, Operations, Procurement (only with `VITE_PROCUREMENT_ENABLED`),
Catalogue, Insights and Account — see `information-architecture.md`. The
original intent was one top-level section per bounded context (Procurement,
Inventory, Tools, Reports, Administration); the implemented groups differ
(Inventory pages sit under Operations and Catalogue; there is no Tools
section).

Each section's landing page is a list or table; drill-in goes to a detail
page (`/materials/:id`, `/suppliers/:id`, `/purchase-orders/:id`) or a side
drawer (movements). Stock actions match how a storeman thinks: issuing,
receiving and counting are dedicated screens under `/stock/*`; transfers,
adjustments and quick issues are forms launched from the Stock page; returns
and reversals are launched from a movement's drawer.

All navigation items are visible to every role; actions inside pages are
hidden by role (TD-015). After sign-in the user lands on the page set by the
`general.defaultLandingPage` setting.

## Evidence
- `afrinov-platform/apps/frontend/src/hooks/useNavGroups.tsx:26-105`
- `afrinov-platform/apps/frontend/src/components/Sidebar.tsx`, `afrinov-platform/apps/frontend/src/components/MobileDrawer.tsx`
- `afrinov-platform/apps/frontend/src/App.tsx:114-162`
- `afrinov-platform/apps/frontend/src/api/landingPath.ts`
