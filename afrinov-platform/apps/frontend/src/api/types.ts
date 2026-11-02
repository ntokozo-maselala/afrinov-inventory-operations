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
  project?: { projectNumber: string; name: string | null; status?: string | null; active?: boolean } | null;
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
  /** Whole days since it went out. */
  daysOut: number;
  /** YYYY-MM-DD it is due back: the latest extension's, else the one agreed at check-out. */
  dueOn: string;
  /** Days past the due date; zero on the day, negative while there are days to go. */
  daysLate: number;
  state: LoanState;
  /** Past its due date (OVERDUE or NEEDS_DECISION). */
  overdue: boolean;
  /** Due date changes, later or earlier, oldest first; previousDueOn is the date each replaced. */
  extensions: Array<{ dueOn: string; previousDueOn: string; reason: string; extendedBy: string; extendedAt: string }>;
}

/**
 * One step in a tool loan's life (GET /tools/loans/:id/history), oldest first.
 * BECAME_OVERDUE is worked out from the dates; nothing is stored for it.
 */
export type LoanEvent =
  | { kind: 'CHECKED_OUT'; at: string; by: string; quantity: string; dueOn: string; note: string | null; overdueOverrideReason: string | null }
  | { kind: 'DUE_DATE_CHANGED'; at: string; by: string; dueOn: string; previousDueOn: string; reason: string }
  | { kind: 'BECAME_OVERDUE'; at: string; dueOn: string }
  | { kind: 'CHECKED_IN'; at: string; by: string; quantity: string; condition: 'GOOD' | 'DAMAGED' | 'LOST'; note: string | null; dueOn: string; daysLate: number };

export interface LoanHistory {
  loanId: string; materialId: string; sku: string; name: string;
  recipientName: string | null; projectNumber: string | null; locationName: string;
  /** How many were lent, and how many are still out. */
  quantity: string; out: string;
  dueOn: string;
  /** Null once it is all back. */
  state: LoanState | null;
  daysLate: number;
  events: LoanEvent[];
}

/** ON_LOAN, DUE_SOON (due tomorrow or today), OVERDUE, or NEEDS_DECISION once far enough past due (Settings > Inventory). */
export type LoanState = 'ON_LOAN' | 'DUE_SOON' | 'OVERDUE' | 'NEEDS_DECISION';

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
  /** Projects material: its project, null until assigned. */
  projectNumber?: string | null;
  project?: { name: string | null; status: string } | null;
  locationId: string; locationName: string; locationType: string;
  /** Whether the item and the location are active: stock is issued only from active ones. */
  materialActive?: boolean; locationActive?: boolean;
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
  /** Null on a tool loan due date change (type DUE_DATE_CHANGE): no stock moved. */
  quantity: string | null; actorId: string; actorName: string;
  projectNumber?: string | null; reasonCode?: string | null; reasonNote?: string | null;
  referenceType?: string | null; referenceId?: string | null;
  reversesId?: string | null; reversedById?: string | null;
  /** Issued to, checked out to or returned by; on a write-off, who was responsible. */
  recipientId?: string | null;
  recipientName?: string | null;
  recipientType?: string | null;
  returnedQuantity?: string | null;
  /** A return: the issue it came back from (when, which slip, from where). */
  returnOf?: { id: string; postedAt: string; issueId: string | null; locationName: string } | null;
  receiptNumber?: string | null; supplierName?: string | null; deliveryRef?: string | null;
  /** A receipt against a purchase order: it cannot be reversed from the movement, only on the order. */
  fromPurchaseOrder?: boolean;
  /** A transfer's other leg: where the stock went to (or came from). */
  otherLocationName?: string | null;
  /** Tool loans. Check-out: the date agreed. Check-in: the date as it stood then. Due date change: the new date. */
  dueOn?: string | null;
  /** Due date change: the date it replaced. */
  previousDueOn?: string | null;
  /** Check-out: the date it is due now, after any changes. */
  currentDueOn?: string | null;
  /** Check-in: days after the due date it came back; zero or less is on time. */
  daysLate?: number | null;
  /** Check-out: why tools were lent to someone who already had an overdue one. */
  overdueOverrideReason?: string | null;
}

/**
 * GET /inventory-transactions/writeoffs-by-responsible: damage, loss and scrap
 * by who was responsible (recipientId null: nobody known), valued at unit cost.
 */
export interface WriteoffsByResponsible {
  currency: string;
  totals: Array<{ recipientId: string | null; recipientName: string | null; recipientType: string | null; count: number; value: string }>;
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
