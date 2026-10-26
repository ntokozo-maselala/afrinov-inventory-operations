# 02 — Domain model and data integrity

## Core model

~~~mermaid
erDiagram
  MATERIAL ||--o{ INVENTORY_TRANSACTION : records
  LOCATION ||--o{ INVENTORY_TRANSACTION : records_at
  MATERIAL ||--o{ INVENTORY_BALANCE : totals
  LOCATION ||--o{ INVENTORY_BALANCE : totals_at
  INVENTORY_TRANSACTION ||--o| INVENTORY_TRANSACTION : reverses
  INVENTORY_TRANSACTION ||--o| INVENTORY_TRANSACTION : pairs_transfer
  PROJECT ||--o{ MATERIAL : classifies
  PROJECT ||--o{ INVENTORY_TRANSACTION : associates
  SUPPLIER ||--o{ PURCHASE_ORDER : supplies
  PURCHASE_ORDER ||--o{ PURCHASE_ORDER_LINE : contains
  GOODS_RECEIPT ||--o{ GOODS_RECEIPT_LINE : contains
  USER ||--o{ INVENTORY_TRANSACTION : acts
  USER ||--o{ USER_ROLE : has
  ROLE ||--o{ USER_ROLE : assigned
~~~

Material and Location are the stock dimensions. InventoryTransaction is the append-only signed ledger. InventoryBalance is a material/location aggregate recomputed from the ledger. Goods receipts and purchase orders track incoming quantities; users, roles and permissions govern actions. Project linkage is present on materials and ledger entries.

## Invariants and enforcement

| Candidate invariant | Enforcement found |
|---|---|
| A transaction references a material, location and actor | Prisma schema declares relations; initial migration has corresponding ledger foreign keys |
| One balance row per material/location | Composite primary key in schema and initial migration |
| Reversal is unique per original transaction | Unique reversesId in schema and initial migration |
| Transfer legs are linked | Unique pairedWithId relation; application writes paired legs atomically |
| Stock balance equals signed ledger sum | Application recomputes aggregate into inventory_balances after writes; not database-triggered |
| Issue/negative adjustment must not make stock negative | Application checks derived balance before inserting ledger effects; no database CHECK constraint or shared concurrency lock |
| A project material belongs to an open project | Application service validation; project FK additionally protects the reference |
| A submitted receipt can be posted once | Sequential state check exists; no atomic claim/lock before effects, so concurrent requests can both pass |
| Returned quantity cannot exceed issue quantity | Application sums prior returns and checks; no DB aggregate constraint/serialization for concurrent returns |
| Inventory balance references valid material/location | Schema declares relations, but migrations create inventory_balances without either FK and no later migration adds them |

Signed quantities are stored as Decimal(18,4). Receipts and transfer-in entries are positive; issues and transfer-out entries are negative; adjustments can have either sign. The ledger is intended to correct errors through reversals rather than updates.

## Confirmed integrity risks

### DATA-01 — Concurrent stock movements can overdraw or stale the balance

InventoryService issue, transfer and negative adjustment paths read inventory_balances and then create ledger rows and recompute the aggregate in a transaction. The shared balance helper performs an ordinary findUnique, and recomputeBalance aggregates ledger rows then upserts the balance. No row lock, conditional balance update or explicit serializable isolation is applied to these stock keys. Under PostgreSQL Read Committed, two requests can both pass a check against the same starting quantity. The balance may also be recomputed against a snapshot that excludes the other uncommitted ledger row.

Returns similarly sum earlier returns and then insert a new return without serializing updates against the original issue. A pair of requests may each observe enough quantity remaining and collectively exceed the issue quantity.

Stock count uses a location advisory lock, but normal movements do not share that lock, so the lock does not establish mutual exclusion with those flows.

This is a source-proven concurrency hazard; a real PostgreSQL race was not executed. Add concurrency integration tests only in an isolated database after a locking/update design is approved.

### DATA-02 — A submitted goods receipt can be posted twice concurrently

postGoodsReceipt reads a receipt and checks POSTED/DRAFT status near the start of the transaction, creates ledger receipts and increments PO line quantities, then changes status to POSTED at the end. The status change is a normal update and is not a conditional state transition that claims the receipt before effects. Two requests can both read SUBMITTED and commit duplicate stock effects. Existing tests include sequential duplicate-post coverage, not a concurrent PostgreSQL test.

### DATA-03 — Missing inventory balance foreign keys in deployed migrations

schema.prisma declares material and location relations on InventoryBalance. The initial migration creates the table and composite key but no foreign keys; a scan of all migrations found no later constraints for inventory_balances. Out-of-band or defect-created rows may therefore become orphaned even though Prisma schema describes stricter relations.

## Migration and transaction review

Migrations are forward-only; repository documentation says there are no down migrations. The Compose backend startup runs prisma migrate deploy, then the compiled seed, then the API. Migration 20260101000022_drop_racks takes an ACCESS EXCLUSIVE lock and safely aborts if rack rows remain. Its error directs operators to run the prior-release racks:to-locations command and resolve the migration as rolled back before retrying. That command is not present in the current package scripts, so cutover requires a documented prior-release artifact and a rehearsed preflight.

Prisma interactive transactions cover stock movements and goods receipt posting, but transactions alone do not prevent stale reads under PostgreSQL's default Read Committed isolation. No destructive migration or seed was run. Test environment guards were inspected; integration tests target a separate localhost _test database and create persistent rows.

## Phase 2 exit

The main entities, ledger semantics, relation constraints, transaction boundaries and migration path were examined. Three material integrity risks are recorded in 07. Open questions include whether negative stock is intentionally forbidden under all business scenarios, whether retries require idempotency keys, and which release team owns rack migration preflight.
