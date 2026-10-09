# Alerting

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

**Operational alerts** (elevated error rate, downtime, failed migrations)
to engineering: **Planned** — nothing in the repository configures them.

**Business alerts** (material below Required Stock) surface inside the
product to the Store Controller/Procurement role: implemented as the
Stock status page, the dashboard's Urgent/Warning tiles and the re-order
list download, controlled by `inventory.enableStockAlerts`. The
notification settings (`notifications.*`) are stored but no code sends
notifications (TD-010). The two audiences should not share a channel.

## Evidence
- `afrinov-platform/apps/frontend/src/pages/Dashboard.tsx:61-62`
- `afrinov-platform/apps/backend/src/modules/reporting/reporting.service.ts:263-266`
- `afrinov-platform/apps/backend/src/modules/settings/settings.service.ts:183-185`
