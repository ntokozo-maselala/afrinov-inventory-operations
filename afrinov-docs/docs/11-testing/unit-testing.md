<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-11-010</b></td>
<td align="center"><b><i>Unit Testing</i></b><br><i>Testing</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-11-010 updated=2026-11-26 by="Ntokozo Maselala" body=41e9aff031a3 -->

# Unit Testing

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Backend unit tests (`npm test` in `apps/backend`) exercise services, routes
and shared rules with the Prisma client replaced by in-memory fakes
(`vi.mock` of `shared/db.js`); a dummy `DATABASE_URL` lets the client
module load. There is no separate framework-free domain layer, so "domain
rules in isolation" means service methods against fakes. Covered rules
include: insufficient balance rejected with `INSUFFICIENT_BALANCE`
(e.g. issuing more than is on hand), reversal rules, returns, PO state
transitions, goods-receipt posting, stock status bands, settings
validation, permission grants, configuration and CORS rules, workbook
mapping and reconciliation.

Not unit-tested: `material.service.ts`, `stock-count.service.ts` (covered
by integration tests), `audit.routes.ts`, and supplier creation in
`procurement.service.ts` (TD-023).

Frontend unit and component tests (`npm test` in `apps/frontend`, jsdom)
cover the API client, auth, permissions hook, shared components, the mock
API, formatting, and the Issue, Receive, Stock count, Stock status, Stock
used, Month-end and Dashboard pages.

## Evidence
- `afrinov-platform/apps/backend/vitest.config.ts:4-7`
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.service.test.ts`
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.service.test.ts`
- `afrinov-platform/apps/backend/src/shared/inventory/stock-status.test.ts`
- `afrinov-platform/apps/frontend/src/pages/*.test.tsx`
