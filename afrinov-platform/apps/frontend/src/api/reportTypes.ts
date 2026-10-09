// Response shapes of the report endpoints (GET /reports/inventory,
// /reports/month-end, /reports/consumption), shared by the pages, the Excel
// exports and the frontend-only mock that mirrors the backend.
import type { StatusBands, StockStatus } from '../lib/stockStatus';

// ── Inventory report ─────────────────────────────────────────────────────
export interface ReportQuery {
  range: 'ALL' | 'TODAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'CUSTOM';
  from?: string;
  to?: string;
  category: string[];
  locationId: string[];
  supplierId: string[];
  materialId: string[];
  stockStatus: 'ALL' | 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  itemStatus: 'ALL' | 'ACTIVE' | 'INACTIVE';
  search?: string;
  movementType?: 'RECEIPT' | 'ISSUE' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'ADJUSTMENT' | 'RETURN';
  page: number;
  pageSize: number;
}

export interface ReportInventoryLine {
  materialId: string;
  sku: string;
  name: string;
  description: string | null;
  category: string;
  unitOfMeasure: string;
  unitCost: number | null;
  requiredStock: number;
  active: boolean;
  locationId: string;
  locationName: string;
  locationType: string;
  quantity: number;
  inventoryValue: number;
  status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  lastUpdated: string | null;
}

export interface ReportCategoryRow {
  category: string;
  skuCount: number;
  quantity: number;
  inventoryValue: number;
  share: number;
}
export interface ReportLocationRow {
  locationId: string;
  locationName: string;
  locationType: string;
  quantity: number;
  inventoryValue: number;
  share: number;
}
export interface ReportSupplierRow {
  supplierId: string | null;
  supplierName: string;
  skuCount: number;
  quantity: number;
  inventoryValue: number;
  share: number;
}
export interface ReportStatusRow {
  status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  skuCount: number;
  quantity: number;
  inventoryValue: number;
}
export interface ReportMovementRow {
  id: string;
  postedAt: string;
  type: string;
  materialId: string;
  materialSku: string;
  materialName: string;
  category: string;
  locationId: string;
  locationName: string;
  quantity: number;
  actorName: string;
  reasonCode: string | null;
  reasonNote: string | null;
  projectNumber: string | null;
  referenceType: string | null;
  referenceId: string | null;
  // Set on a reversal (the movement it cancels) and on a reversed movement
  // (the reversal that cancels it). Optional: older payloads omit them.
  reversesId?: string | null;
  reversedById?: string | null;
}
export interface ReportMovementSummary {
  receipts: { count: number; quantity: number };
  issues: { count: number; quantity: number };
  transfers: { count: number; quantity: number };
  adjustments: { count: number; quantity: number };
  returns: { count: number; quantity: number };
  total: { count: number; quantity: number };
}
export interface ReportKpis {
  skuCount: number;
  totalQuantity: number;
  inventoryValue: number;
  lowStockCount: number;
  outOfStockCount: number;
  categoryCount: number;
  locationCount: number;
  supplierCount: number;
  movementCount: number;
  currency: string;
  generatedAt: string;
  rangeLabel: string;
}
export interface ReportResult {
  kpis: ReportKpis;
  byStatus: ReportStatusRow[];
  byCategory: ReportCategoryRow[];
  byLocation: ReportLocationRow[];
  bySupplier: ReportSupplierRow[];
  exceptions: ReportInventoryLine[];
  movements: ReportMovementRow[];
  movementSummary: ReportMovementSummary;
  inventory: ReportInventoryLine[];
  inventoryTotal: number;
  page: number;
  pageSize: number;
  currency: string;
  generatedAt: string;
}

// ── Month-end report ─────────────────────────────────────────────────────
export interface MonthEndItem {
  sku: string; name: string; location: string; requiredStock: number; currentStock: number;
  unitCost: number | null; value: number | null; percentOfRequired: number | null; reorderQuantity: number | null; status: StockStatus;
}
export interface MonthEndCategory {
  category: string; items: MonthEndItem[]; value: number; urgent: number; warning: number; itemsInStock: number;
  used: Array<{ sku: string; name: string; location: string; used: number; value: number | null }>; usedValue: number;
}
export interface MonthEndReport {
  month: string; from: string; to: string; generatedAt: string; currency: string; bands: StatusBands;
  categories: MonthEndCategory[];
  total: { items: number; itemsInStock: number; value: number; urgent: number; warning: number; usedValue: number };
}

// ── Stock used (consumption) ─────────────────────────────────────────────
export interface ConsumptionItem {
  materialId: string; sku: string; name: string; category: string; unitOfMeasure: string;
  issued: number; returned: number; used: number; unitCost: number | null; value: number | null;
}

export interface ConsumptionLine {
  id: string; postedAt: string; type: 'ISSUE' | 'RETURN'; sku: string; name: string; unitOfMeasure: string;
  /** Positive: issued; negative: returned. */
  quantity: number;
  projectNumber: string | null;
  issuedBy: string;
}

export interface ConsumptionReport {
  from: string;
  to: string;
  currency: string;
  items: ConsumptionItem[];
  byProject: Array<{ projectNumber: string | null; projectName: string | null; value: number; items: number }>;
  byRecipient: Array<{ recipientId: string | null; name: string | null; type: string | null; value: number; items: number; issues: number }>;
  lines?: ConsumptionLine[];
  byCategory: Array<{ category: string; value: number; items: number }>;
  total: { value: number; items: number; unpriced: number };
}

export const NO_PROJECT = '__none__';
export const NO_RECIPIENT = '__none__';
