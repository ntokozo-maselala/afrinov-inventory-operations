<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-11-005</b></td>
<td align="center"><b><i>Integration Testing</i></b><br><i>Testing</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-11-005 updated=2026-11-26 by="Ntokozo Maselala" body=5eecccad6be3 -->

# Integration Testing

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Use cases against a real PostgreSQL database through the real HTTP server
(`npm run test:integration` in `apps/backend`). The database must be
migrated and seeded first; the tests sign in as the seeded admin, so
`SEED_ADMIN_PASSWORD` must match the one used by the seed. CI does this on
every backend pull request with a throwaway `postgres:16-alpine`
container.

| Suite (`integration/`) | What it proves |
|---|---|
| `auth.real-http.test.ts` | Login and token use against the real database |
| `inventory.real-http.test.ts` | Receipt/issue/transfer/adjust change stock; transfers create two linked legs; no movement takes stock below zero; invalid movements return 400 and record nothing; multi-line issues are all-or-nothing; reversal instead of edit; read-only users cannot move stock |
| `procurement.real-http.test.ts` | Posting a receipt part-receives the order; no double posting; over-receipt rolled back; receive-all; unapproved orders cannot be received; closing short needs a reason |
| `stock-receipts.real-http.test.ts` | Counter receipts |
| `returns.real-http.test.ts` | Returns against issues |
| `stock-counts.real-http.test.ts` | Counts post variances; stale counts refused |
| `recipients.real-http.test.ts` | Recipient rules |
| `consumption.real-http.test.ts`, `month-end.real-http.test.ts`, `reorder-list.real-http.test.ts` | Report figures from real ledgers |
| `opening-balances.real-http.test.ts` | Workbook opening-balance import |

Most suites assert the ADR-002 invariant (stored balance = ledger sum) with
`ledgerAndBalance()`.

Not run during the 2026-10-09 documentation check (needs a live
database).

## Evidence
- `afrinov-platform/apps/backend/integration/*.real-http.test.ts`
- `afrinov-platform/apps/backend/integration/inventory.real-http.test.ts:88-276`
- `afrinov-platform/apps/backend/integration/procurement.real-http.test.ts:118-206`
- `afrinov-platform/apps/backend/integration/helpers.ts:74-88`
- `.github/workflows/backend-ci.yml:56-110`
