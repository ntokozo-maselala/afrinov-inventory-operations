// Derived analytics computed from API data on the frontend.
// These functions are pure (no side effects) and fully tested.
// They compute aggregate metrics from raw report data, purchase orders,
// suppliers, and locations — answering operational business questions.

import type { ReportMovementRow, ReportInventoryLine } from '../mock/mockReport';
import type { PurchaseOrderSummary } from '../hooks/useDashboardData';
import type { MockSupplier } from '../mock/types';
import { formatCurrency } from './currency';
import { formatNumber } from './format';

export const DEFAULT_CURRENCY = 'ZAR';

// ── Inventory Value Trend ──────────────────────────────────────────────────

export interface TrendPoint {
  date: string;
  label: string;
  value: number;
  isCumulative: boolean;
}

/**
 * Computes a daily inventory-value trend from movement data.
 * Starts from a baseline (the current total inventory value) and walks
 * backward through movements to reconstruct historical value.
 *
 * Each day's point represents the estimated cumulative inventory value
 * at the end of that day, based on the running net of receipts/issues.
 */
export function computeInventoryValueTrend(
  movements: ReportMovementRow[],
  inventoryLines: ReportInventoryLine[],
  currentTotalValue: number,
): TrendPoint[] {
  if (!movements.length) return [];

  const unitCostMap = new Map<string, number>();
  for (const line of inventoryLines) {
    if (line.unitCost !== null && !unitCostMap.has(line.materialId)) {
      unitCostMap.set(line.materialId, line.unitCost);
    }
  }

  const sorted = [...movements].sort((a, b) => a.postedAt.localeCompare(b.postedAt));

  // Group net value delta by day
  const dailyDeltas = new Map<string, number>();
  for (const m of sorted) {
    const day = m.postedAt.slice(0, 10);
    const cost = unitCostMap.get(m.materialId) ?? 0;
    const valueImpact = Math.abs(m.quantity) * cost;
    const isReceipt = m.type === 'RECEIPT' || m.type === 'TRANSFER_IN';
    const delta = isReceipt ? valueImpact : -valueImpact;
    dailyDeltas.set(day, (dailyDeltas.get(day) ?? 0) + delta);
  }

  const days = Array.from(dailyDeltas.keys()).sort();
  if (days.length === 0) return [];

  // Compute the baseline by walking back from currentTotalValue through
  // all movements in reverse order (newest first → oldest first).
  let historicalBaseline = currentTotalValue;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const m = sorted[i]!;
    const cost = unitCostMap.get(m.materialId) ?? 0;
    const valueImpact = Math.abs(m.quantity) * cost;
    const isReceipt = m.type === 'RECEIPT' || m.type === 'TRANSFER_IN';
    // Undo the movement: reverse receipt (+→-), reverse issue (-→+)
    historicalBaseline += isReceipt ? -valueImpact : valueImpact;
  }

  // Build trend points: for each day, compute the cumulative value
  const result: TrendPoint[] = [];
  let running = historicalBaseline;

  for (const day of days) {
    running += dailyDeltas.get(day) ?? 0;
    result.push({
      date: day,
      label: formatTrendLabel(day),
      value: Math.max(0, running),
      isCumulative: true,
    });
  }

  return result;
}

function formatTrendLabel(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-ZA', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

// ── Purchase Order Analytics ───────────────────────────────────────────────

export interface POStatusSummary {
  status: string;
  label: string;
  count: number;
  value: number;
  share: number;
}

export interface POSupplierSummary {
  supplierId: string;
  supplierName: string;
  orderCount: number;
  totalValue: number;
  receivedValue: number;
}

export interface POKpi {
  label: string;
  value: string;
  helper: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'brand' | 'info';
  iconType: string;
}

export function computePOStatusDistribution(
  purchaseOrders: PurchaseOrderSummary[],
): POStatusSummary[] {
  if (!purchaseOrders.length) return [];

  const statusMap = new Map<string, { count: number; value: number }>();

  for (const po of purchaseOrders) {
    const key = po.status;
    const existing = statusMap.get(key) ?? { count: 0, value: 0 };
    existing.count++;
    const poValue = computePOValue(po);
    existing.value += poValue;
    statusMap.set(key, existing);
  }

  const totalValue = computeTotalPOValue(purchaseOrders);
  const result = Array.from(statusMap.entries()).map(([status, data]) => ({
    status,
    label: poStatusLabel(status),
    count: data.count,
    value: data.value,
    share: totalValue > 0 ? data.value / totalValue : 0,
  }));

  return result.sort((a, b) => b.value - a.value);
}

export function computePOSupplierDistribution(
  purchaseOrders: PurchaseOrderSummary[],
  _suppliers: MockSupplier[],
): POSupplierSummary[] {
  if (!purchaseOrders.length) return [];

  const supplierMap = new Map<string, POSupplierSummary>();

  for (const po of purchaseOrders) {
    const supplierName = po.supplier?.name ?? 'Unknown';
    const existing = supplierMap.get(po.supplierId) ?? {
      supplierId: po.supplierId ?? '',
      supplierName,
      orderCount: 0,
      totalValue: 0,
      receivedValue: 0,
    };
    existing.orderCount++;
    const poValue = computePOValue(po);
    existing.totalValue += poValue;
    existing.receivedValue += computeReceivedValue(po);
    supplierMap.set(po.supplierId ?? '', existing);
  }

  return Array.from(supplierMap.values()).sort((a, b) => b.totalValue - a.totalValue);
}

export function computePOKpis(purchaseOrders: PurchaseOrderSummary[], currency = DEFAULT_CURRENCY): POKpi[] {
  if (!purchaseOrders || purchaseOrders.length === 0) {
    return [
      { label: 'Open Purchase Orders', value: '—', helper: 'No data', tone: 'neutral', iconType: 'doc' },
      { label: 'Pending Approval', value: '—', helper: 'No data', tone: 'neutral', iconType: 'doc' },
      { label: 'Completed', value: '—', helper: 'No data', tone: 'neutral', iconType: 'doc' },
      { label: 'Total PO Value', value: '—', helper: 'No data', tone: 'neutral', iconType: 'cash' },
    ];
  }

  const openStatuses = ['DRAFT', 'PENDING_APPROVAL', 'SUBMITTED', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED'];
  const openPOs = purchaseOrders.filter((po) => openStatuses.includes(po.status));
  const pendingApproval = purchaseOrders.filter((po) =>
    ['PENDING_APPROVAL', 'SUBMITTED'].includes(po.status),
  );
  const completed = purchaseOrders.filter((po) =>
    ['FULLY_RECEIVED', 'DELIVERED', 'CLOSED'].includes(po.status),
  );
  const cancelled = purchaseOrders.filter((po) =>
    ['CANCELLED', 'REJECTED'].includes(po.status),
  );

  const totalValue = computeTotalPOValue(purchaseOrders);
  const receivedValue = purchaseOrders.reduce((acc, po) => acc + computeReceivedValue(po), 0);
  const pendingValue = openPOs.reduce((acc, po) => acc + computePOValue(po), 0);

  return [
    {
      label: 'Open Purchase Orders',
      value: formatNumber(openPOs.length),
      helper: `${openPOs.length} of ${formatNumber(purchaseOrders.length)} active`,
      tone: openPOs.length > 0 ? 'warning' : 'neutral',
      iconType: 'doc',
    },
    {
      label: 'Pending Approval',
      value: formatNumber(pendingApproval.length),
      helper: `${pendingApproval.length} awaiting review`,
      tone: pendingApproval.length > 0 ? 'info' : 'neutral',
      iconType: 'doc',
    },
    {
      label: 'Completed Orders',
      value: formatNumber(completed.length),
      helper: `${formatNumber(purchaseOrders.length)} total`,
      tone: 'success',
      iconType: 'doc',
    },
    {
      label: 'Total PO Value',
      value: formatCurrency(totalValue, currency),
      helper: `${formatCurrency(receivedValue, currency)} received \u00b7 ${formatCurrency(pendingValue, currency)} pending`,
      tone: 'brand',
      iconType: 'cash',
    },
    {
      label: 'Cancelled',
      value: formatNumber(cancelled.length),
      helper: `${cancelled.length} cancelled orders`,
      tone: cancelled.length > 0 ? 'danger' : 'neutral',
      iconType: 'alert',
    },
  ];
}

function computePOValue(po: PurchaseOrderSummary): number {
  if (!po.lines) return 0;
  return po.lines.reduce((acc, line) => {
    const orderedQty = Number(line.orderedQty ?? 0);
    const unitCost = Number((line.material as { unitCost?: string })?.unitCost ?? 0);
    return acc + orderedQty * unitCost;
  }, 0);
}

function computeReceivedValue(po: PurchaseOrderSummary): number {
  if (!po.lines) return 0;
  return po.lines.reduce((acc, line) => {
    const receivedQty = Number(line.receivedQty ?? 0);
    const unitCost = Number((line.material as { unitCost?: string })?.unitCost ?? 0);
    return acc + receivedQty * unitCost;
  }, 0);
}

function computeTotalPOValue(purchaseOrders: PurchaseOrderSummary[]): number {
  return purchaseOrders.reduce((acc, po) => acc + computePOValue(po), 0);
}

function poStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: 'Draft',
    PENDING_APPROVAL: 'Pending approval',
    SUBMITTED: 'Submitted',
    APPROVED: 'Approved',
    SENT: 'Sent',
    SHIPPED: 'Shipped',
    PARTIALLY_RECEIVED: 'Partially received',
    FULLY_RECEIVED: 'Fully received',
    DELIVERED: 'Delivered',
    CLOSED: 'Closed',
    CANCELLED: 'Cancelled',
    REJECTED: 'Rejected',
  };
  return labels[status] ?? status;
}

// ── Supplier Analytics ───────────────────────────────────────────────────

export interface SupplierKpi {
  label: string;
  value: string;
  helper: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'brand' | 'info';
}

export function computeSupplierKpis(
  suppliers: MockSupplier[],
  purchaseOrders: PurchaseOrderSummary[],
  currency = DEFAULT_CURRENCY,
): SupplierKpi[] {
  if (!suppliers || suppliers.length === 0) {
    return [
      { label: 'Active Suppliers', value: '—', helper: 'No data', tone: 'neutral' },
      { label: 'Purchase Volume', value: '—', helper: 'No data', tone: 'neutral' },
      { label: 'Avg. Order Value', value: '—', helper: 'No data', tone: 'neutral' },
      { label: 'Total Orders', value: '—', helper: 'No data', tone: 'neutral' },
    ];
  }

  const activeSuppliers = suppliers.filter((s) => s.active);
  const totalPOValue = computeTotalPOValue(purchaseOrders);

  return [
    {
      label: 'Active Suppliers',
      value: formatNumber(activeSuppliers.length),
      helper: `${formatNumber(suppliers.length)} total`,
      tone: 'brand',
    },
    {
      label: 'Purchase Volume',
      value: formatCurrency(totalPOValue, currency),
      helper: `${formatNumber(purchaseOrders.length)} orders`,
      tone: 'success',
    },
    {
      label: 'Avg. Order Value',
      value: purchaseOrders.length > 0
        ? formatCurrency(totalPOValue / purchaseOrders.length, currency)
        : '—',
      helper: `Across ${formatNumber(purchaseOrders.length)} orders`,
      tone: 'info',
    },
    {
      label: 'Top Supplier',
      value: (() => {
        const dist = computePOSupplierDistribution(purchaseOrders, suppliers);
        return dist.length > 0 ? dist[0]!.supplierName.slice(0, 20) : '—';
      })(),
      helper: 'By purchase volume',
      tone: 'neutral',
    },
  ];
}

// ── Top Inventory Items ────────────────────────────────────────────────────

export interface TopItem {
  materialId: string;
  sku: string;
  name: string;
  category: string;
  quantity: number;
  unitCost: number | null;
  inventoryValue: number;
  requiredStock: number;
  status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  locationName: string;
  shortfall: number;
}

export function computeTopInventoryItems(
  inventory: ReportInventoryLine[],
  sortBy: 'value' | 'quantity' | 'shortfall',
  limit = 10,
): TopItem[] {
  if (!inventory.length) return [];

  const items: TopItem[] = inventory.map((line) => ({
    materialId: line.materialId,
    sku: line.sku,
    name: line.name,
    category: line.category,
    quantity: line.quantity,
    unitCost: line.unitCost,
    inventoryValue: line.inventoryValue,
    requiredStock: line.requiredStock,
    status: line.status,
    locationName: line.locationName,
    shortfall: Math.max(0, line.requiredStock - line.quantity),
  }));

  const sorted = items.sort((a, b) => {
    if (sortBy === 'value') return b.inventoryValue - a.inventoryValue;
    if (sortBy === 'quantity') return b.quantity - a.quantity;
    return b.shortfall - a.shortfall;
  });

  return sorted.slice(0, limit);
}

// ── Category Label ────────────────────────────────────────────────────────

export function categoryLabel(category: string): string {
  const labels: Record<string, string> = {
    FASTENERS_SLUGS_INSULATION: 'Fasteners, Slugs & Insulation',
    TOOLING_PPE_ELECTRICAL: 'Tooling, PPE & Electrical',
    PROJECT_MATERIAL: 'Project Material',
    CONSUMABLES: 'Consumables',
    TOOLS: 'Tools',
  };
  return labels[category] ?? category;
}

// ── Status Label / Tone ───────────────────────────────────────────────────

export function statusLabel(status: string): string {
  return ({
    IN_STOCK: 'In stock',
    LOW_STOCK: 'Low stock',
    OUT_OF_STOCK: 'Out of stock',
  } as Record<string, string>)[status] ?? status;
}

export function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'OUT_OF_STOCK') return 'danger';
  if (status === 'LOW_STOCK') return 'warning';
  if (status === 'IN_STOCK') return 'success';
  return 'neutral';
}
