// Rows the core stock endpoints return, shared by every page that lists or
// picks from them. Small { id, name } dropdown shapes stay with their page.
import type { StockStatus } from '../lib/stockStatus';

/** A catalogue item (GET /materials). Quantities and prices come as strings. */
export interface Material {
  id: string; sku: string; name: string; description?: string | null;
  category: string; unitOfMeasure: string; requiredStock: string;
  unitCost?: string | null; active: boolean;
}

/** One item at one location (GET /reports/current-stock). */
export interface CurrentStockRow {
  materialId: string; materialSku: string; materialName: string;
  category: string; unitOfMeasure: string; requiredStock: string;
  locationId: string; locationName: string; locationType: string;
  quantity: string; belowThreshold: boolean;
  /** The item's status from its total across locations, the same on each of its rows. */
  stockStatus?: StockStatus | null; percentOfRequired?: number | null;
}

/** One ledger entry (GET /inventory-transactions). */
export interface MovementRow {
  id: string;
  /** Paging cursor: pass as `before` to get the next, older rows. */
  cursor: string;
  postedAt: string; type: string;
  materialId: string; materialSku: string; materialName: string; unitOfMeasure?: string;
  /** Issues: the slip this line belongs to. */
  issueId?: string | null;
  locationId: string; locationName: string;
  quantity: string; actorId: string; actorName: string;
  projectNumber?: string | null; reasonCode?: string | null; reasonNote?: string | null;
  referenceType?: string | null; referenceId?: string | null;
  reversesId?: string | null; reversedById?: string | null;
  recipientName?: string | null;
  returnedQuantity?: string | null;
  receiptNumber?: string | null; supplierName?: string | null; deliveryRef?: string | null;
  /** A transfer's other leg: where the stock went to (or came from). */
  otherLocationName?: string | null;
}

/** One entry of the shop's other activity (GET /activity): counts, catalogue, user and settings changes. */
export interface ActivityRow {
  id: string;
  /** Paging cursor: pass as `before` to get the next, older rows. */
  cursor: string;
  at: string; action: string; entityType: string; entityId: string;
  actorId: string | null; actorName: string;
  summary: string;
  /** Where in the app the record lives, when it has a page. */
  link: string | null;
}

/** One issue slip on the issued-stock report (GET /inventory-issues): every line one issue posted. */
export interface IssueSlip {
  id: string; cursor: string; issuedAt: string;
  recipientName: string | null; recipientType: string | null; projectNumber: string | null; issuedByName: string;
  lines: MovementRow[];
}

/** One delivery on the received-stock report (GET /stock-receipts). */
export interface ReceiptRecord {
  id: string; cursor: string; number: string; receivedAt: string;
  supplierName: string; deliveryRef: string | null; receivedByName: string;
  lines: Array<{ materialId: string; sku: string; name: string; unitOfMeasure: string; locationName: string; quantity: string }>;
}

/** One count on the stock-counts report (GET /stock-counts). Items that matched are not stored, so only differences are listed. */
export interface CountRecord {
  id: string; cursor: string; at: string;
  locationId: string | null; locationName: string; countedByName: string;
  counted: number; adjusted: number; note: string | null;
  differences: Array<{ materialId: string; sku: string; name: string; unitOfMeasure: string; quantity: string }>;
}
