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
