// The stock floor (BR-009, ADR-047): no balance — an item at a location, held
// for a project or for Stores — is ever below zero.
//
// It is kept in two layers. The first is the rule every path that moves stock
// follows inside its transaction: take the balance lock
// (`lockInventoryBalances`), then read the balance, check it, write the ledger
// line and recompute the balance — in that order, because a reading taken
// before the lock can be stale by the time the line is written. The second is
// a database constraint on `inventory_balances`, so a path that ever skips or
// reorders the first layer is refused instead of leaving stock below zero.
//
// The constraint is on the balance, not on ledger lines: a line is a signed
// movement, and a transfer writes −x then +x before it recomputes, so only the
// balance it ends with is checked.

/**
 * The database constraint that holds the floor (migration
 * 20260101000073_stock_floor). The error translation recognises its refusal by
 * this name, so a rename must change both.
 */
export const STOCK_FLOOR_CONSTRAINT = 'inventory_balances_quantity_non_negative';

/** What the person reads when the database, not the service, refused the movement. */
export const STOCK_FLOOR_MESSAGE = 'Not enough stock for this movement: it would take the balance below zero, so nothing was saved.';
