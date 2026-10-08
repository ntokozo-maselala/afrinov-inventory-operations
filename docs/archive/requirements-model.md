# Requirements Model — Afrinov Platform

Generated: 2026-09-17

---

## Functional Requirements

### FR-INV-001 — Material Management
**As** a store controller / technician
**I want** to create, view, edit, and deactivate materials
**So that** the system tracks all inventory items with proper metadata

**Validation Rules**:
- `sku` must be unique
- `name` is required
- `category` must be one of: FASTENERS_SLUGS_INSULATION, TOOLING_PPE_ELECTRICAL, PROJECT_MATERIAL, CONSUMABLES, TOOLS
- `unitOfMeasure` is required
- `requiredStock` defaults to 0; non-negative
- `unitCost` optional; non-negative decimal
- `active` defaults to true (soft-delete)

**State**: `active` boolean (soft delete semantics — inactive materials don't appear in selection lists)

### FR-INV-002 — Location Management
**As** a store controller
**I want** to create, view, edit, deactivate, and delete locations
**So that** physical placement of stock is tracked

**Validation Rules**:
- `name` must be unique (case-sensitive)
- `code` optional but unique if present
- `type` required: RACK, STOREROOM, SHOP_FLOOR_AREA, CONTAINER, OFF_SITE
- Extended fields: address, description, contactPerson, contactPhone, contactEmail, notes

**State**: `active` boolean

**Invariant**: Locations referenced by racks, goods receipt lines, or inventory transactions cannot be deleted (returns CONFLICT with dependency counts)

### FR-INV-003 — Inventory Ledger (Issue)
**As** a store controller / technician
**I want** to issue stock to a project
**So that** materials are consumed and tracked

**Workflow**:
1. User opens Issue form (material, location, quantity, optional project, optional recipient)
2. UI validates quantity > 0
3. Service checks material.active, location.active
4. Service checks balance ≥ quantity (if `inventory.enableNegativeStockPrevention` = true, default)
5. Creates `InventoryTransaction` (type=ISSUE, quantity=-qty)
6. Recomputes `InventoryBalance`
7. Dispatches `InventoryIssued` domain event
8. If balance ≤ `material.requiredStock` and alerts enabled, dispatches `StockThresholdReached`

**Invariants**:
- Quantity must be positive (absolute value)
- Balance never mutated directly (ADR-002)
- If `enableNegativeStockPrevention`, issue cannot make balance negative

### FR-INV-004 — Inventory Ledger (Transfer)
**As** a store controller
**I want** to transfer stock between locations
**So that** materials can be redistributed

**Workflow**:
1. User opens Transfer form (material, fromLocation, toLocation, quantity)
2. Service validates: quantity > 0, fromLocation ≠ toLocation
3. Service checks balance at source ≥ quantity
4. Creates two `InventoryTransaction` records atomically:
   - TRANSFER_OUT (quantity=-qty) at source
   - TRANSFER_IN (quantity=+qty) at dest, paired via `pairedWithId`
5. Recomputes balances for both locations
6. Dispatches `InventoryTransferred` event

**Invariants**:
- Atomic: both legs commit or neither
- Transfers paired via unique `pairedWithId` FK

### FR-INV-005 — Inventory Ledger (Adjustment)
**As** a store controller
**I want** to adjust stock by a signed quantity with a reason code
**So that** inventory discrepancies can be corrected

**Workflow**:
1. User opens Adjustment form (material, location, signed quantity, reasonCode, optional note)
2. Service validates: quantity ≠ 0, reasonCode required (COUNT_VARIANCE, DAMAGE, LOSS, SCRAP, OTHER)
3. If negative adjustment and `enableNegativeStockPrevention`, check balance
4. Creates `InventoryTransaction` (type=ADJUSTMENT, quantity=signed)
5. Recomputes balance
6. Dispatches `InventoryAdjusted` event

### FR-INV-006 — Transaction History & Actor Update
**As** a store controller
**I want** to view inventory transaction history and update who performed a transaction
**so that** accountability is maintained

**Query**: Filter by materialId, type, projectNumber, date range; capped at 1000 records

**Actor Update**: PATCH /inventory-transactions/:id — changes `actorId`; validates new actor exists & is active; creates audit log entry

### FR-PROC-001 — Supplier Management
**As** a procurement officer
**I want** to create and manage suppliers
**so that** suppliers are tracked for purchasing

**Validation**: name unique (case-insensitive); contact fields optional

### FR-PROC-002 — Purchase Order Lifecycle
**As** a procurement officer
**I want** to create, submit, approve, ship, deliver, and cancel purchase orders
**so that** materials can be procured through a controlled workflow

**State Machine**:
```
DRAFT → PENDING_APPROVAL → APPROVED → SHIPPED → DELIVERED
  ↓         ↓                    ↓
CANCELLED  CANCELLED          CANCELLED
```

**Transitions**:
- **Create**: New PO in DRAFT state; generates sequential PO number (advisory lock serialized); requires supplier + ≥1 line
- **Submit**: DRAFT|SUBMITTED → PENDING_APPROVAL (if approval required) or APPROVED (if not)
- **Approve**: PENDING_APPROVAL|SUBMITTED → APPROVED; records `approvedById`, `approvedAt`
- **Ship**: APPROVED → SHIPPED; records tracking number, carrier, shipment notes, `shippedById`, `shippedAt`
- **Deliver**: SHIPPED → DELIVERED; creates RECEIPT transactions for line shortfalls; records `deliveredById`, `deliveredAt`; location required
- **Cancel**: DRAFT|PENDING_APPROVAL|SUBMITTED|APPROVED → CANCELLED; reason required; requires `purchaseOrders.allowCancellation` setting

**Invariants**:
- Optimistic concurrency: `updateMany` with WHERE status guard; conflict error if count=0
- PO number generation serialized via `pg_advisory_xact_lock`
- Edit allowed after approval if `purchaseOrders.allowEditAfterApproval` = true (default)
- Cannot edit when DELIVERED or CANCELLED

### FR-PROC-003 — Goods Receipt Posting
**As** a receiving clerk
**I want** to create and post goods receipts
**so that** received materials enter the inventory ledger

**State Machine**:
```
DRAFT → SUBMITTED → POSTED
```

**Posting workflow**:
1. Validate status = SUBMITTED
2. For each GR line:
   - Create RECEIPT inventory transaction
   - If linked to PO line: increment `receivedQty`; reject if exceeds `orderedQty`
   - Recompute balance for (material, location)
3. Set GR status = POSTED
4. Update PO status: FULLY_RECEIVED if all lines fully received; PARTIALLY_RECEIVED if some; APPROVED if none

### FR-REP-001 — Current Stock Report
**As** a store controller
**I want** to see current stock levels by material and location
**so that** I can manage inventory

**Query**: Current stock with filters (material, location, supplier, category, date range, stock status, search, pagination)

### FR-REP-002 — Movement History Report
**As** a store controller
**I want** to see all inventory transactions
**so that** I can audit movements

### FR-REP-003 — Low Stock Report
**As** a store controller
**I want** to see items at or below reorder threshold
**so that** I can trigger replenishment

**Logic**: `quantity ≤ requiredStock` where material is active

### FR-REP-004 — Inventory Export Report
**As** a planner
**I want** to export inventory data as Excel or PDF with filters
**so that** I can share reports with stakeholders

**Supports**: Excel (xlsx), PDF, with filter parameters passed as query string

### FR-SEC-001 — Authentication
**As** a user
**I want** to authenticate with email and password
**so that** I can access the system

**Mechanics**: bcrypt-hashed passwords; JWT token (HS256, 12h expiry); token stored in localStorage

### FR-SEC-002 — Authorization
**As** a system
**I want** to enforce role-based permissions on every action
**so that** users can only do what their role allows

**Model**: Role → Permission assignments; deny-by-default; permissions checked server-side per route

### FR-SEC-003 — User Management
**As** an admin
**I want** to create, view, edit, and deactivate users
**so that** access control can be managed

**Validation**: Email unique (case-insensitive); ≥1 role required; password minimum 8 chars

### FR-SEC-004 — Audit Logging
**As** an auditor
**I want** to see who changed what and when
**so that** accountability is maintained

**Events**: All create/update/delete operations on entities create audit log entries
**Read**: GET /audit?entityType=X&limit=N

### FR-CONF-001 — Settings Management
**As** an admin
**I want** to configure system-wide settings
**so that** behavior can be customized per organization

**Categories**: general, inventory, purchase_orders, notifications, users, appearance, security, system, data

**Validation**: Per-type validation (string length, integer, boolean, enum membership)
**Audit**: All changes logged

---

## Non-Functional Requirements

### NFR-REL-001: Reliability
- All mutating operations run inside database transactions
- Optimistic locking prevents lost updates on state transitions
- Graceful shutdown drains in-flight requests

### NFR-PERF-001: Performance
- Query results capped at reasonable limits (transactions: 1000 max)
- Dashboard aggregates computed server-side
- Frontend lazy-loads routes and components

### NFR-SEC-001: Security
- Passwords hashed (bcrypt, 10 rounds)
- JWT secret validated in production (no insecure defaults)
- CORS restricted to configured origins in production
- Error responses never leak internal details (sanitized in global handler)
- Rate limiting not yet implemented (noted gap)

### NFR-OPS-001: Operability
- Health check endpoints (`/health`, `/health/ready`)
- Structured logging (pino) with correlation IDs
- Configurable log level
- Graceful SIGTERM/SIGINT handling

### NFR-CONFIG-001: Configuration
- Fail-fast config validation at startup
- Required: DATABASE_URL, JWT_SECRET
- Production-insecure secrets rejected in production env

---

## Business Rules

### BR-001: Zero as Source of Truth
The `InventoryBalance` table is a materialized view. No code path writes to it directly. It is always recomputed from `InventoryTransaction` aggregates.

### BR-002: Negative Stock Prevention
When `inventory.enableNegativeStockPrevention` = true (default), issuing or adjusting stock cannot drive balance below zero.

### BR-003: PO Number Uniqueness
PO numbers are sequential within the current year (format: `PO-YYYY-NNNN`). Generation is serialized via PostgreSQL advisory lock to prevent collisions.

### BR-004: Receipt Over-Receive Prevention
Posting a GoodsReceipt line linked to a PO line cannot exceed the ordered quantity. The `receivedQty` on the PO line is checked and rejected if `projected > orderedQty`.

### BR-005: Transfer Pairing
Every transfer creates two transactions linked by `pairedWithId`. Updating one updates the other's reference (foreign key constraint).

### BR-006: Location Referential Integrity
Locations cannot be deleted if they are referenced by racks, goods receipt lines, or inventory transactions. They can only be deactivated.

### BR-007: Inactive Entity Handling
- Inactive materials: transactions blocked
- Inactive locations: transactions blocked
- Inactive users: cannot be assigned as transaction actors
- Inactive suppliers: filtered from selection (not deleted)

### BR-008: PO Edit Lifecycle
- DRAFT, PENDING_APPROVAL, SUBMITTED: always editable
- APPROVED: editable if `allowEditAfterApproval` = true
- SHIPPED, DELIVERED, PARTIALLY_RECEIVED, FULLY_RECEIVED, CLOSED: not editable
- CANCELLED, REJECTED: not editable

---

## Domain Entities

| Entity | Key Fields | State | Invariants |
|--------|-----------|-------|------------|
| User | id, email, passwordHash, active | active/inactive | Email unique; ≥1 role |
| Role | id, name, description | — | Name unique (enum) |
| Permission | id, code, description | — | Code unique |
| Material | id, sku, name, category, unitOfMeasure, requiredStock, unitCost, active | active/inactive | SKU unique |
| Location | id, name, code, type, active | active/inactive | Name/code unique |
| Rack | id, code, name, locationId, projectNumber, capacity, status | ACTIVE/INACTIVE/FULL | Code unique |
| Supplier | id, name, contact*, active | active/inactive | Name unique (case-insensitive) |
| Project | projectNumber, name, code, status, ..., active | PLANNING/ACTIVE/CLOSED/CANCELLED | projectNumber PK |
| PurchaseOrder | id, number, supplierId, status, ..., lifecycle timestamps | See state machine | Number unique |
| GoodsReceipt | id, number, purchaseOrderId, supplierId, status, ... | DRAFT/SUBMITTED/POSTED | Number unique |
| InventoryTransaction | id, materialId, locationId, type, quantity, ... | — (append-only) | Signed quantity by type |
| InventoryBalance | materialId, locationId, quantity | — (derived) | Never written directly |
| Setting | key, value, type, category, enumOptions, isEditable | — | Type validation on write |
| AuditLogEntry | id, actorId, action, entityType, entityId, before, after | — (append-only) | Never modified |

---

## Commands (Write Operations)

| Command | Service | Input | Effect |
|---------|---------|-------|--------|
| IssueStock | InventoryService | IssueInput (materialId, locationId, quantity, actorId, ...opts) | CREATE InventoryTransaction(ISSUE) + recomputeBalance |
| TransferStock | InventoryService | TransferInput (materialId, fromId, toId, quantity, actorId) | CREATE 2× InventoryTransaction(TRANSFER_*) + recomputeBoth + pair |
| AdjustStock | InventoryService | AdjustmentInput (materialId, locationId, quantity, reasonCode, actorId) | CREATE InventoryTransaction(ADJUSTMENT) + recomputeBalance |
| PostGoodsReceipt | InventoryService | GoodsReceiptPostInput (goodsReceiptId, actorId) | Update PO receivedQty; CREATE RECEIPT txns; SET GR=POSTED |
| UpdateTransactionActor | InventoryService | (transactionId, newActorId, changedBy) | UPDATE InventoryTransaction.actorId; CREATE AuditLogEntry |
| CreatePurchaseOrder | PurchaseOrderService | CreatePOInput (supplierId, lines, notes, expectedDeliveryDate) | CREATE PO (DRAFT) with lines |
| SubmitPurchaseOrder | PurchaseOrderService | (id, actorId) | UPDATE PO status (→ PENDING_APPROVAL or APPROVED) |
| ApprovePurchaseOrder | PurchaseOrderService | (id, actorId) | UPDATE PO status → APPROVED |
| ShipPurchaseOrder | PurchaseOrderService | ShipInput (id, trackingNumber, carrier, notes) | UPDATE PO status → SHIPPED |
| DeliverPurchaseOrder | PurchaseOrderService | DeliverInput (id, locationId, notes) | UPDATE PO status → DELIVERED; CREATE RECEIPT txns |
| CancelPurchaseOrder | PurchaseOrderService | CancelInput (id, reason) | UPDATE PO status → CANCELLED |
| CreateSupplier | SupplierService | CreateSupplierInput | CREATE Supplier |
| CreateMaterial | MaterialService | Material fields | CREATE Material |
| CreateLocation | LocationService | Location fields | CREATE Location |
| CreateRack | RackService | Rack fields | CREATE Rack |
| UpdateSetting | SettingsService | (key, value) | UPDATE Setting + CREATE AuditLogEntry |

---

## Queries (Read Operations)

| Query | Service | Returns | Notes |
|-------|---------|---------|-------|
| QueryTransactionHistory | InventoryService | Paginated transaction list | Filter by material/type/project/date; caps at 1000 |
| GetMaterial | MaterialService | Material | By id |
| ListMaterials | MaterialService | Material[] | Filtered, sorted by active/name |
| GetLocation | LocationService | Location + dependency counts | Cannot delete if deps > 0 |
| ListLocations | LocationService | Location[] | Filtered, sorted |
| GetRack | RackService | Rack incl location | By id |
| ListRacks | RackService | Rack[] | Filtered by status/location/project |
| GetPurchaseOrder | PurchaseOrderService | PO incl lines/supplier/history | By id |
| ListPurchaseOrders | PurchaseOrderService | PO[] | Filtered by status |
| PO History | PurchaseOrderService | AuditLogEntry[] | By PO id |
| GetGoodsReceipt | GoodsReceiptService | GR incl lines | By id |
| ListGoodsReceipts | GoodsReceiptService | GR[] | With supplier/lines |
| CreateGoodsReceipt | GoodsReceiptService | GR | DRAFT → SUBMITTED |
| GetCurrentUser | IdentityService | User | Via `/auth/me` |
| ListUsers | UserService | User[] | With roles |
| ListSuppliers | SupplierService | Supplier[] | Filtered by name |
| GetSetting / ListSettings / GetSettingValues | SettingsService | Setting(s) | Batch fetch supported |
| LowStockReport | ReportingService | LowStockItem[] | quantity ≤ requiredStock |
| CurrentStockReport | ReportingService | StockRow[] | With balances |
| MovementHistoryReport | ReportingService | MovementRow[] | Transaction history |
| InventoryExportReport | ReportingService | Excel/PDF blob | Filter params via query string |
| AuditLog | AuditService | AuditLogEntry[] | Filter by entityType |

---

## State Machines

### PurchaseOrderStatus
```
DRAFT ──submit──→ PENDING_APPROVAL ──approve──→ APPROVED ──ship──→ SHIPPED ──deliver──→ DELIVERED
 │                    │    ↑                      │                     │                    ↑
 │                    │    └── (approve again)   │                     │                    │
 │                    │                          │                     │                    │
 └────cancel─────────┘                          └────cancel───────────┘                    │
                                                                                           │
 └────(if approval not required)──→ APPROVED ──ship──→ SHIPPED ──deliver──→ DELIVERED ──────┘
         ↓                           │                          │
    cancel                          cancel                       │
         ↓                           ↓                          │
    CANCELLED ←────────────────── CANCELLED ←───────────────────┘

Also from SUBMITTED (legacy): → APPROVED → SHIPPED → DELIVERED
Rejected POs: REJECTED (terminal)
```

### GoodsReceiptStatus
```
DRAFT → SUBMITTED → POSTED
```

### RackStatus
```
ACTIVE ↔ INACTIVE ↔ FULL
```

### Material.active / Location.active / Supplier.active / User.active / Project.active
```
true ↔ false (boolean toggle, not deleted)
```

---

## Validation Rules Summary

| Input | Rule | Enforced Where |
|-------|------|----------------|
| Email | Must match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` | Frontend (signup), Backend (create user) |
| Password | Min 8 chars | Frontend (signup), Backend (create user) |
| SKU | Unique | Backend (material routes) |
| Material category | Must be valid enum | Backend (schema), Frontend (form) |
| Quantity (issue/transfer/adjust) | Must be non-zero | Backend service, Frontend form |
| PO lines | ≥1 line | Backend service |
| Cancellation reason | Required, non-empty | Backend service |
| Setting value | Type/Enum validation | Backend SettingsService, Frontend mock validation |
| Location refs | Count before delete | Backend service, Frontend mock check |

---

## Permissions Matrix

| Action | Role Required | Permission Code |
|--------|--------------|----------------|
| View dashboard | any | (via auth) |
| Manage materials | STORE_CONTROLLER, ADMIN | create:material, update:material, delete:material |
| Issue stock | STORE_CONTROLLER, TECHNICIAN, ADMIN | issue:inventory |
| Transfer stock | STORE_CONTROLLER, ADMIN | transfer:inventory |
| Adjust stock | STORE_CONTROLLER, ADMIN | adjust:inventory |
| Manage purchase orders | PROCUREMENT, ADMIN | create:purchase_order, submit:purchase_order, approve:purchase_order |
| Ship/receive PO | PROCUREMENT, STORE_CONTROLLER, ADMIN | ship:purchase_order, receive:purchase_order |
| Manage suppliers | PROCUREMENT, ADMIN | create:supplier |
| Administer users | ADMIN | create:user, update:user |
| Change settings | ADMIN | update:setting |
| View audit log | ADMIN, VIEWER | view:audit |

Note: The exact permission code constants are defined in `shared/permissions.ts`.