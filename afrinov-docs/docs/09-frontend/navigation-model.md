# Navigation Model

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** a7a7360, 2026-10-20

A persistent sidebar (a drawer on small screens) with six groups:
Overview, Store, Reports, Operations, Procurement (unless
`VITE_PROCUREMENT_ENABLED=false`) and Account — see
`information-architecture.md`. The original intent was one top-level section
per bounded context (Procurement, Inventory, Tools, Reports, Administration);
the implemented groups follow the store's work instead: the counter
actions and Tools under Store, the reports and Movements under Reports, and
the master lists under Operations.

Each section's landing page is a list or table; drill-in goes to a detail
page (`/materials/:id`, `/suppliers/:id`, `/purchase-orders/:id`) or a side
drawer (movements). Stock actions match how a storeman thinks: issuing,
receiving, returning and counting are dedicated screens under `/stock/*`;
transfers and adjustments are forms launched from the Stock page; reversals
are launched from a movement's drawer. A purchase order is raised and edited
on its own pages (`/purchase-orders/new`, `/purchase-orders/:id/edit`), and
other pages link to the new-order page with the supplier and items filled in.

Menu items for actions are shown only to roles that may take them, and
action buttons inside pages are hidden by role; an action page reached by a
typed or old link shows a "no access" message (`10-security/access-control.md`).
After sign-in the user lands on the page set by the
`general.defaultLandingPage` setting, except that a user whose only role is
APPROVER lands on the purchase orders waiting for their approval.

## Evidence
- `afrinov-platform/apps/frontend/src/hooks/useNavGroups.tsx`
- `afrinov-platform/apps/frontend/src/components/Sidebar.tsx`, `afrinov-platform/apps/frontend/src/components/MobileDrawer.tsx`
- `afrinov-platform/apps/frontend/src/App.tsx`
- `afrinov-platform/apps/frontend/src/api/landingPath.ts`
