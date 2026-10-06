# API Architecture

REST over HTTPS, JSON bodies, one base path per module:

```
/api/v1/materials
/api/v1/locations
/api/v1/suppliers
/api/v1/purchase-orders
/api/v1/goods-receipts
/api/v1/inventory-transactions
/api/v1/inventory-issues       (write-only business action)
/api/v1/inventory-transfers    (write-only business action)
/api/v1/inventory-adjustments  (write-only business action)
/api/v1/tools/check-out
/api/v1/tools/check-in
/api/v1/reports/current-stock
/api/v1/reports/movement-history
/api/v1/reports/stock-value
/api/v1/reports/project-consumption
/api/v1/reports/low-stock
/api/v1/users
/api/v1/roles
```
