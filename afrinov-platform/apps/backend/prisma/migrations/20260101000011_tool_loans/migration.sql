-- Tool check-out and check-in are ledger movements: LOAN takes a tool off the
-- shelf to a recipient, LOAN_RETURN brings it back.
ALTER TYPE "InventoryTransactionType" ADD VALUE 'LOAN';
ALTER TYPE "InventoryTransactionType" ADD VALUE 'LOAN_RETURN';
