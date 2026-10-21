// Rows the core stock endpoints return, shared by every page that lists or
// picks from them. Small { id, name } dropdown shapes stay with their page.
import type { StockStatus } from '../lib/stockStatus';

/** A catalogue item (GET /materials). Quantities and prices come as strings. */
export interface Material {
  id: string; sku: string; name: string; description?: string | null;
  category: string; unitOfMeasure: string; requiredStock: string;
  unitCost?: string | null; active: boolean;
  /** Tools kept as one unit: the serial number. */
  serialNumber?: string | null;
  /** STORES, or PROJECTS for Project Material (bought for one job). */
  section?: 'STORES' | 'PROJECTS';
  /** Projects material: the project it is bought for; null until assigned. */
  projectNumber?: string | null;
  project?: { projectNumber: string; name: string | null } | null;
}

/** A supplier (GET /suppliers). The vendor fields follow the AFRI-0000_x purchase order template. */
export interface Supplier {
  id: string; name: string; active: boolean;
  contactName?: string | null; contactEmail?: string | null; contactPhone?: string | null; notes?: string | null;
  /** The template's "V001". */
  vendorCode?: string | null;
  address?: string | null;
  /** ZAR, USD, EUR or GBP. */
  currency?: string;
  paymentTerms?: string | null;
  website?: string | null;
  /** What the supplier provides, e.g. "Compressor hire". */
  services?: string | null;
}

/** A tool lent and not yet all back (GET /tools). */
export interface OpenLoan {
  loanId: string; slipId: string | null; recipientId: string | null; recipientName: string | null; projectNumber: string | null;
  locationId: string; locationName: string;
  /** How many were lent, and how many of them are still out. */
  quantity: string; out: string;
  checkedOutAt: string; checkedOutBy: string; note: string | null;
  /** Whole days out, and whether that is past Settings > Inventory's overdue days. */
  daysOut: number; overdue: boolean;
}

/** A tool with what is in store where, what is out, and with whom (GET /tools). */
export interface ToolRow {
  materialId: string; sku: string; name: string; serialNumber: string | null; unitOfMeasure: string;
  inStore: string; onLoan: string; owned: string;
  locations: Array<{ locationId: string; locationName: string; quantity: string }>;
  loans: OpenLoan[];
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
/** An issue a recipient can still bring stock back from (GET /inventory-returns/returnable). Quantities are decimal strings. */
export interface ReturnableLine {
  issueTransactionId: string;
  issueId: string | null;
  postedAt: string;
  materialId: string; sku: string; name: string; unitOfMeasure: string;
  locationId: string; locationName: string; locationActive: boolean;
  projectNumber: string | null;
  issued: string; returned: string; outstanding: string;
}

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
  recipientId?: string | null;
  recipientName?: string | null;
  returnedQuantity?: string | null;
  /** A return: the issue it came back from (when, which slip, from where). */
  returnOf?: { id: string; postedAt: string; issueId: string | null; locationName: string } | null;
  receiptNumber?: string | null; supplierName?: string | null; deliveryRef?: string | null;
  /** A receipt against a purchase order: it cannot be reversed from the movement, only on the order. */
  fromPurchaseOrder?: boolean;
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

/** One count on the stock-counts report (GET /stock-counts): its full sheet, or for older counts only its differences. */
export interface CountRecord {
  id: string; cursor: string; at: string;
  locationId: string | null; locationName: string; countedByName: string;
  counted: number; adjusted: number; note: string | null;
  differences: Array<{ materialId: string; sku: string; name: string; unitOfMeasure: string; quantity: string }>;
  /** Every item counted, matched or not, with what the system had. Empty for counts posted before sheets were kept. */
  lines: Array<{ materialId: string; sku: string; name: string; unitOfMeasure: string; expected: string; counted: string; note?: string | null }>;
}
