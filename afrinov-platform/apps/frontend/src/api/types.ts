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
  id: string; postedAt: string; type: string;
  materialId: string; materialSku: string; materialName: string;
  locationId: string; locationName: string;
  quantity: string; actorId: string; actorName: string;
  projectNumber?: string | null; reasonCode?: string | null; reasonNote?: string | null;
  referenceType?: string | null; referenceId?: string | null;
  reversesId?: string | null; reversedById?: string | null;
  recipientName?: string | null;
  returnedQuantity?: string | null;
  receiptNumber?: string | null; supplierName?: string | null; deliveryRef?: string | null;
}
