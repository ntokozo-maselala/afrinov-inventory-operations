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

export type AdjustmentReasonCode = 'COUNT_VARIANCE' | 'DAMAGE' | 'LOSS' | 'SCRAP' | 'OTHER' | 'FOUND' | 'PO_RECEIPT' | 'TRANSFER' | 'ADJUSTMENT';

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
  /** Each issue is later marked used up or broken. Never on a tool. */
  trackUse?: boolean;
}

/** Used up or broken against an issue line, as the backend's consumable_outcomes; withdrawsId marks a withdrawal. */
export interface MockConsumableOutcome {
  id: string; issueTransactionId: string; outcome: 'USED_UP' | 'BROKEN'; quantity: number;
  note: string | null; withdrawsId: string | null; actorId: string; createdAt: string;
  /** The RETURN booked in the same counter visit; that row shows the mark. */
  returnTransactionId?: string | null;
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
  /** Percent off the unit price; "0" for none. */
  discountPercent?: string;
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
  /** Who signed it, oldest first (po-approval.ts). */
  signatures?: Array<{ step: string; signedAt: string; standIn?: boolean; signedBy?: { id: string; name: string } | null }>;
  /** Rand per unit of its currency, locked when submitted. */
  exchangeRate?: string | null;
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
  /** Who raised it: the demo user (user-1) for an order raised in the demo; unset on the seeded ones, raised by others. */
  createdById?: string;
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
  /** Whose stock it is: the project it is held for; absent for Stores stock. */
  heldForProject?: string;
  referenceType?: string;
  referenceId?: string;
  pairedWithId?: string;
  reversesId?: string;
  /** Issues and tool loans: shared by every line one issue or check-out posted (the slip). */
  issueId?: string;
  /** Tool loans: YYYY-MM-DD it is due back, agreed at check-out. Absent on loans from before due dates. */
  dueOn?: string;
  /** Tool loans: why tools were lent to someone who already had an overdue one. */
  overdueOverrideReason?: string;
}

export interface MockStockRow {
  /** Whose stock the row is: the project it is held for, or null for Stores stock. */
  heldForProject?: string | null;
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
  /** Whether the item and the location are active, as the server says. */
  materialActive: boolean;
  locationActive: boolean;
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
  /**
   * DUE_DATE_CHANGE: a tool loan's due date changed. USED_UP, BROKEN: a mark
   * booked with nothing back on the shelf; OUTCOME_WITHDRAWN: a mark withdrawn;
   * ITEM_DEACTIVATED, ITEM_REACTIVATED: an item's status changed. Listed among
   * the movements; no stock moved.
   */
  type: InventoryTransactionType | 'DUE_DATE_CHANGE' | 'USED_UP' | 'BROKEN' | 'OUTCOME_WITHDRAWN' | 'ITEM_DEACTIVATED' | 'ITEM_REACTIVATED';
  materialId: string;
  materialSku: string;
  materialName: string;
  unitOfMeasure: string;
  issueId?: string | null;
  /** Null on an item's status change: it belongs to no one location. */
  locationId: string | null;
  locationName: string;
  /** Null on a due date change. */
  quantity: string | null;
  actorId: string;
  actorName: string;
  recipientId?: string;
  /** An adjustment's reason, or why an item's status changed. */
  reasonCode?: AdjustmentReasonCode | string;
  reasonNote?: string;
  projectNumber?: string;
  /** Whose stock moved: the project it is held for, or null for Stores stock. */
  heldForProject?: string | null;
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
  usedUpQuantity?: string | null;
  brokenQuantity?: string | null;
  trackUse?: boolean;
  dueOn?: string | null;
  previousDueOn?: string | null;
  currentDueOn?: string | null;
  daysLate?: number | null;
  overdueOverrideReason?: string | null;
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
  /** Typed as the sheet has it, on a Sales RFQ, whose lines have no catalogue item. */
  description?: string;
  unitOfMeasure?: string;
  /** What Sales asked for, as the buyer matched it, on a Procurement RFQ. */
  salesRfqLineId?: string | null;
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
  /** The currency the quote was given in; the supplier's when it was recorded. */
  currency?: string | null;
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
  awardedAt?: string | null;
  sentAt?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  lines: MockRfqLine[];
  suppliers: MockRfqSupplier[];
  history: NonNullable<MockPurchaseOrder['history']>;
}
