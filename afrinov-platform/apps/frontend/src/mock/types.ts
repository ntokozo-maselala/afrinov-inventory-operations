// Shared mock domain types — kept as aliases of the same shapes the real API
// returns so existing page components work unmodified. This file is purely
// development-only and is only imported when VITE_FRONTEND_ONLY is true.

export type MaterialCategory =
  | 'FASTENERS_SLUGS_INSULATION'
  | 'TOOLING_PPE_ELECTRICAL'
  | 'PROJECT_MATERIAL'
  | 'CONSUMABLES'
  | 'TOOLS';

export type LocationType = 'RACK' | 'STOREROOM' | 'SHOP_FLOOR_AREA' | 'CONTAINER' | 'OFF_SITE';

export type InventoryTransactionType =
  | 'RECEIPT'
  | 'ISSUE'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'ADJUSTMENT'
  | 'RETURN';

export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'CLOSED'
  | 'CANCELLED';

export type GoodsReceiptStatus = 'DRAFT' | 'SUBMITTED' | 'POSTED';

export type AdjustmentReasonCode = 'COUNT_VARIANCE' | 'DAMAGE' | 'LOSS' | 'SCRAP' | 'OTHER' | 'PO_RECEIPT' | 'TRANSFER' | 'ADJUSTMENT';

export interface MockUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
}

export interface MockMaterial {
  id: string;
  sku: string;
  name: string;
  description?: string;
  category: MaterialCategory;
  unitOfMeasure: string;
  requiredStock: string;
  unitCost?: string;
  active: boolean;
}

export interface MockLocation {
  id: string;
  name: string;
  code?: string;
  type: LocationType;
  active: boolean;
  address?: string;
  description?: string;
  contactPerson?: string;
  contactPhone?: string;
  contactEmail?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  inventoryCount?: number;
}

export interface MockSupplier {
  id: string;
  name: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
  active: boolean;
}

export interface MockPurchaseOrderLine {
  id: string;
  materialId: string;
  orderedQty: string;
  receivedQty: string;
}

export interface MockPurchaseOrder {
  id: string;
  number: string;
  supplierId: string;
  status: PurchaseOrderStatus;
  notes?: string;
  createdAt: string;
  expectedDeliveryDate?: string | null;
  approvedAt?: string | null;
  approvedBy?: MockUser | null;
  deliveredAt?: string | null;
  deliveredBy?: MockUser | null;
  deliveryNotes?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: MockUser | null;
  cancellationReason?: string | null;
  closedAt?: string | null;
  closedBy?: MockUser | null;
  closeReason?: string | null;
  createdBy?: MockUser | null;
  lines: MockPurchaseOrderLine[];
  history?: Array<{ id: string; action: string; actorId: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; createdAt: string }>;
  goodsReceipts?: Array<{ id: string; number: string; status: string; receivedAt: string; deliveryRef?: string; lines: Array<{ quantity: string }> }>;
}

export interface MockGoodsReceiptLine {
  id: string;
  materialId: string;
  locationId: string;
  quantity: string;
  purchaseOrderLineId?: string;
}

export interface MockGoodsReceipt {
  id: string;
  number: string;
  purchaseOrderId?: string;
  supplierId: string;
  deliveryRef?: string;
  status: GoodsReceiptStatus;
  receivedAt: string;
  lines: MockGoodsReceiptLine[];
}

export interface MockRecipient {
  id: string;
  name: string;
  type: 'WORKER' | 'MACHINE' | 'SITE' | 'CONTRACTOR';
  notes?: string | null;
  active: boolean;
}

export interface MockInventoryTransaction {
  id: string;
  postedAt: string;
  type: InventoryTransactionType;
  materialId: string;
  locationId: string;
  quantity: string;
  actorId: string;
  recipientId?: string;
  reasonCode?: AdjustmentReasonCode;
  reasonNote?: string;
  projectNumber?: string;
  referenceType?: string;
  referenceId?: string;
  pairedWithId?: string;
  reversesId?: string;
}

export interface MockStockRow {
  materialId: string;
  materialSku: string;
  materialName: string;
  category: MaterialCategory;
  unitOfMeasure: string;
  requiredStock: string;
  locationId: string;
  locationName: string;
  locationType: LocationType;
  quantity: string;
  belowThreshold: boolean;
}

export interface MockMovementRow {
  id: string;
  postedAt: string;
  type: InventoryTransactionType;
  materialId: string;
  materialSku: string;
  materialName: string;
  locationId: string;
  locationName: string;
  quantity: string;
  actorId: string;
  actorName: string;
  recipientId?: string;
  reasonCode?: AdjustmentReasonCode;
  reasonNote?: string;
  projectNumber?: string;
  referenceType?: string;
  referenceId?: string;
  reversesId?: string;
  reversedById?: string;
  recipientName?: string | null;
  recipientType?: string | null;
  receiptNumber?: string | null;
  supplierName?: string | null;
  deliveryRef?: string | null;
  returnedQuantity?: string | null;
}

export type MockRackStatus = 'ACTIVE' | 'INACTIVE' | 'FULL';

export interface MockRack {
  id: string;
  code: string;
  name: string;
  description?: string;
  locationId?: string;
  projectNumber?: string;
  capacity?: number;
  status: MockRackStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  location?: { id: string; name: string };
}

export type MockProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';

export interface MockProject {
  projectNumber: string;
  name: string;
  code?: string;
  description?: string;
  status: MockProjectStatus;
  managerId?: string;
  manager?: { id: string; name: string; email: string };
  client?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}