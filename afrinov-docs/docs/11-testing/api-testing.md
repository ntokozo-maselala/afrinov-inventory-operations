<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-11-002</b></td>
<td align="center"><b><i>API Testing</i></b><br><i>Testing</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-11-002 updated=2026-11-26 by="Ntokozo Maselala" body=182b269e742a -->

# API Testing

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Target: every endpoint in `08-api/resource-model.md` — happy path,
validation errors (400), auth failures (401/403), business-rule failures
(409/422) matching `08-api/error-model.md` exactly.

Implemented:
- Route tests with Fastify `inject` and mocked services:
  `src/modules/inventory/inventory.routes.test.ts` (validation, 401/403,
  201 for movements, returns and reversals; no `PATCH` on transactions),
  `src/modules/identity/auth.routes.test.ts`, `src/server*.test.ts`,
  `src/security.regression.test.ts`.
- The integration suites (`integration-testing.md`) call the real HTTP API
  and check status and error codes.

Not every endpoint has route-level tests; per-endpoint coverage is not
measured (no coverage report is configured).

## Evidence
- `afrinov-platform/apps/backend/src/modules/inventory/inventory.routes.test.ts`
- `afrinov-platform/apps/backend/src/modules/identity/auth.routes.test.ts`
- `afrinov-platform/apps/backend/vitest.config.ts` — no coverage settings
