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
  | 'RETURN'
  // Tools: lent (negative) and back (positive), as the backend's LOAN and LOAN_RETURN.
  | 'LOAN'
  | 'LOAN_RETURN';

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
  serialNumber?: string | null;
  /** Project Material only: the project it is bought for (null until assigned). */
  projectNumber?: string | null;
}

export interface MockLocation {
  id: string;
  name: string;
  code?: string;
  type: LocationType;
  active: boolean;
  /** The room or area it stands in (one level; never a rack). */
  parentId?: string;
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
  vendorCode?: string;
  address?: string;
  currency?: string;
  paymentTerms?: string;
  website?: string;
  services?: string;
  active: boolean;
}

export interface MockPurchaseOrderLine {
  id: string;
  materialId: string;
  orderedQty: string;
  receivedQty: string;
  /** Excluding VAT; null when no price was given. */
  unitPrice?: string | null;
  /** YYYY-MM-DD; null: the order's expected date. */
  deliveryDate?: string | null;
}

export interface MockPurchaseOrder {
  id: string;
  number: string;
  supplierId: string;
  status: PurchaseOrderStatus;
  notes?: string;
  createdAt: string;
  currency?: string;
  /** Percent, as a string like the server's Decimal. */
  vatRate?: string;
  /** Raised each time the order is changed after approval. */
  revision?: number;
  // The template's order details (see PurchaseOrderDetailsFields).
  projectNumber?: string | null;
  /** The supplier's contact and address on this order. */
  supplierContactName?: string | null;
  supplierContactPhone?: string | null;
  supplierContactEmail?: string | null;
  supplierAddress?: string | null;
  paymentTerms?: string | null;
  paymentMilestone?: string | null;
  settlementDiscount?: string;
  shippingTerms?: string | null;
  penaltiesApply?: boolean;
  /** The small print as it was when the order was approved; null before. */
  printedTerms?: Record<'terms' | 'latePenalty' | 'documentation' | 'invoicing' | 'invoiceEmail' | 'codeOfConduct', string> | null;
  deliveryMethod?: 'DELIVERY' | 'COLLECTION';
  deliveryTo?: string | null;
  deliveryAddress?: string | null;
  deliveryCountry?: string | null;
  deliveryContactName?: string | null;
  deliveryContactPhone?: string | null;
  afrinovContact?: string | null;
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
  history?: Array<{ id: string; action: string; actorId: string | null; actorName?: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; createdAt: string }>;
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
  /** Issues and tool loans: shared by every line one issue or check-out posted (the slip). */
  issueId?: string;
}

export interface MockStockRow {
  materialId: string;
  materialSku: string;
  materialName: string;
  category: MaterialCategory;
  /** Projects material: its project, null until assigned. */
  projectNumber?: string | null;
  project?: { name: string | null; status: string } | null;
  unitOfMeasure: string;
  requiredStock: string;
  locationId: string;
  locationName: string;
  locationType: LocationType;
  quantity: string;
  belowThreshold: boolean;
  /** The item's status from its total across locations; null when stock alerts are off. */
  stockStatus: 'URGENT' | 'WARNING' | 'OK' | 'NOT_SET' | null;
  percentOfRequired: number | null;
}

export interface MockMovementRow {
  id: string;
  /** Paging cursor, as the backend returns it. */
  cursor: string;
  postedAt: string;
  type: InventoryTransactionType;
  materialId: string;
  materialSku: string;
  materialName: string;
  unitOfMeasure: string;
  issueId?: string | null;
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
  otherLocationName?: string | null;
  supplierName?: string | null;
  deliveryRef?: string | null;
  fromPurchaseOrder?: boolean;
  returnOf?: { id: string; postedAt: string; issueId: string | null; locationName: string } | null;
  returnedQuantity?: string | null;
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

// Requests for quotation, as the server keeps them (rfq.service.ts).
export type RfqStatus = 'DRAFT' | 'SENT' | 'AWARDED' | 'CANCELLED';

export interface MockRfqLine {
  id: string;
  /** The RFQ sheet's ITEM column: 1, 2, 3, … */
  lineNo: number;
  materialId: string;
  quantity: string;
}

/** A supplier asked to quote, and their quote once it is recorded. */
export interface MockRfqSupplier {
  id: string;
  supplierId: string;
  quoteReference: string | null;
  quotedAt: string | null;
  validUntil: string | null;
  leadTime: string | null;
  notes: string | null;
  declined: boolean;
  createdAt: string;
  prices: Array<{ rfqLineId: string; unitPrice: string }>;
  /** The supplier's own quotation PDF, kept in memory as the server keeps it in the database. */
  quoteFile?: { fileName: string; size: number; uploadedAt: string; data: Uint8Array } | null;
}

export interface MockRfq {
  id: string;
  number: string;
  status: RfqStatus;
  projectNumber: string | null;
  description: string | null;
  notes: string | null;
  penaltiesApply: boolean;
  issuedAt: string | null;
  closingDate: string | null;
  createdAt: string;
  updatedAt: string;
  purchaseOrderId: string | null;
  sentAt?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  lines: MockRfqLine[];
  suppliers: MockRfqSupplier[];
  history: NonNullable<MockPurchaseOrder['history']>;
}
