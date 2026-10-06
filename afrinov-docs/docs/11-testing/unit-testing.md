# Unit Testing

Cover domain rules in isolation, no database: sufficient-balance check,
reorder-threshold evaluation, PO/GoodsReceipt/Tool state machine legal
transitions, InventoryBalance derivation logic (sum of signed quantities).
Example: given balance 12 at location D-1, issuing 20 must be rejected with
`INSUFFICIENT_BALANCE`, not silently allowed to go negative.
