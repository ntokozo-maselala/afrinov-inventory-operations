# Integration Testing

Use cases against a real (test) database: posting a Goods Receipt actually
creates the expected InventoryTransaction rows and updates PO status;
issuing stock actually decrements the derived balance; a Stock Transfer
creates exactly two linked, balanced transactions; an Adjustment without a
reason is rejected at the database/application boundary.
